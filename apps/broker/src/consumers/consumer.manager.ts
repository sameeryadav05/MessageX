
import { randomUUID } from "node:crypto";

import type { ClientConnection } from "../connection/client-connection.js";

import {
  claimNextMessage,
  requeueMessagesForConnection,
  rejectMessage
} from "../messages/message.repository.js";

interface ConsumerSubscription {
  consumerTag: string;
  queueName: string;
  connection: ClientConnection;
}

export class ConsumerManager {
  private readonly subscriptions = new Map<
    string,
    Map<string, ConsumerSubscription>
  >();

  private readonly claiming = new Set<string>();

  // Tracks the delivery currently occupying each consumer's prefetch slot.
  private readonly inFlight = new Map<string, string>();

  // Tracks deliveryTag -> queueName independently of subscriptions.
  // This allows ACK/NACK even after CANCEL.
  private readonly deliveryQueues = new Map<string, string>();

  private getKey(connectionId: string, queueName: string): string {
    return `${connectionId}:${queueName}`;
  }

  subscribe(
    connection: ClientConnection,
    queueName: string
  ): string {
    let connectionSubscriptions = this.subscriptions.get(connection.id);

    if (!connectionSubscriptions) {
      connectionSubscriptions = new Map();
      this.subscriptions.set(connection.id, connectionSubscriptions);
    }

    const existing = connectionSubscriptions.get(queueName);

    if (existing) {
      return existing.consumerTag;
    }

    const consumerTag = randomUUID();

    connectionSubscriptions.set(queueName, {
      consumerTag,
      queueName,
      connection
    });

    return consumerTag;
  }

  isSubscribed(connectionId: string, queueName: string): boolean {
    return this.subscriptions.get(connectionId)?.has(queueName) ?? false;
  }

  async deliverNext(
    connection: ClientConnection,
    queueName: string
  ): Promise<boolean> {
    const key = this.getKey(connection.id, queueName);

    if (
      !connection.isConnected ||
      !this.isSubscribed(connection.id, queueName) ||
      this.claiming.has(key) ||
      this.inFlight.has(key)
    ) {
      return false;
    }

    this.claiming.add(key);

    try {
      const message = await claimNextMessage(queueName, connection.id);

      if (!message) {
        return false;
      }

      // Subscription may have been cancelled while the DB claim was running.
      if (!this.isSubscribed(connection.id, queueName)) {
        await rejectMessage(message.deliveryTag, connection.id, true);
        return false;
      }

      if (!connection.isConnected) {
        await requeueMessagesForConnection(connection.id);
        return false;
      }

      this.inFlight.set(key, message.deliveryTag);
      this.deliveryQueues.set(message.deliveryTag, queueName);

      const subscription = this.subscriptions
        .get(connection.id)
        ?.get(queueName);

      connection.send({
        version: 1,
        type: "EVENT",
        event: "MESSAGE_DELIVERED",
        payload: {
          consumerTag: subscription?.consumerTag,
          queueName,
          messageId: message.id,
          deliveryTag: message.deliveryTag,
          body: message.payload,
          headers: message.headers,
          routingKey: message.routingKey,
          deliveryCount: message.deliveryCount,
          createdAt: message.createdAt.toISOString()
        }
      });

      return true;
    } catch (error) {
      console.error(
        `[Consumer] Failed to deliver message from queue '${queueName}':`,
        error
      );

      await requeueMessagesForConnection(connection.id);

      const deliveryTag = this.inFlight.get(key);

      if (deliveryTag) {
        this.deliveryQueues.delete(deliveryTag);
      }

      this.inFlight.delete(key);

      return false;
    } finally {
      this.claiming.delete(key);
    }
  }

  /**
   * Releases the prefetch slot after a valid ACK/NACK.
   * Works even if the subscription was already cancelled.
   */
  settleDelivery(
    connectionId: string,
    deliveryTag: string
  ): string | null {
    const queueName = this.deliveryQueues.get(deliveryTag);

    if (!queueName) {
      return null;
    }

    const key = this.getKey(connectionId, queueName);

    if (this.inFlight.get(key) !== deliveryTag) {
      return null;
    }

    this.inFlight.delete(key);
    this.deliveryQueues.delete(deliveryTag);

    return queueName;
  }

  /**
   * Cancels a subscription without discarding its in-flight message.
   */
  cancel(
    connectionId: string,
    consumerTag: string
  ): string | null {
    const connectionSubscriptions = this.subscriptions.get(connectionId);

    if (!connectionSubscriptions) {
      return null;
    }

    for (const [queueName, subscription] of connectionSubscriptions) {
      if (subscription.consumerTag === consumerTag) {
        connectionSubscriptions.delete(queueName);

        if (connectionSubscriptions.size === 0) {
          this.subscriptions.delete(connectionId);
        }

        return queueName;
      }
    }

    return null;
  }

  /**
   * Removes all subscriptions and requeues messages when a client disconnects.
   */
  async removeConnection(connectionId: string): Promise<void> {
    this.subscriptions.delete(connectionId);

    for (const [key, deliveryTag] of this.inFlight) {
      if (key.startsWith(`${connectionId}:`)) {
        this.inFlight.delete(key);
        this.deliveryQueues.delete(deliveryTag);
      }
    }

    for (const key of this.claiming) {
      if (key.startsWith(`${connectionId}:`)) {
        this.claiming.delete(key);
      }
    }

    await requeueMessagesForConnection(connectionId);
  }

  /**
   * Attempts delivery to all subscribed consumers.
   * Optionally excludes one connection (used after NACK/requeue).
   */
  async deliverAvailable(
    excludeConnectionId?: string
  ): Promise<void> {
    const deliveries: Promise<boolean>[] = [];

    for (const [connectionId, subscriptions] of this.subscriptions) {
      if (connectionId === excludeConnectionId) {
        continue;
      }

      for (const subscription of subscriptions.values()) {
        deliveries.push(
          this.deliverNext(
            subscription.connection,
            subscription.queueName
          )
        );
      }
    }

    await Promise.all(deliveries);
  }
}
