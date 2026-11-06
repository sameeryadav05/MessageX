import { randomUUID } from "node:crypto";

import type { ClientConnection } from "../connection/client-connection.js";
import { claimNextMessage, requeueMessagesForConnection } from "../messages/message.repository.js";

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
  private readonly inFlight = new Map<string, string>();

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

      if (!connection.isConnected) {
        await requeueMessagesForConnection(connection.id);
        return false;
      }

      this.inFlight.set(key, message.deliveryTag);

      connection.send({
        version: 1,
        type: "EVENT",
        event: "MESSAGE_DELIVERED",
        payload: {
          consumerTag: this.subscriptions
            .get(connection.id)
            ?.get(queueName)?.consumerTag,
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
      this.inFlight.delete(key);

      return false;
    } finally {
      this.claiming.delete(key);
    }
  }

  /**
   * Releases the prefetch slot after a valid ACK/NACK.
   * Returns the queue that can now deliver another message.
   */
  settleDelivery(
    connectionId: string,
    deliveryTag: string
  ): string | null {
    const connectionSubscriptions = this.subscriptions.get(connectionId);

    if (!connectionSubscriptions) {
      return null;
    }

    for (const [queueName] of connectionSubscriptions) {
      const key = this.getKey(connectionId, queueName);

      if (this.inFlight.get(key) === deliveryTag) {
        this.inFlight.delete(key);
        return queueName;
      }
    }

    return null;
  }

  async removeConnection(connectionId: string): Promise<void> {
    this.subscriptions.delete(connectionId);

    for (const key of this.inFlight.keys()) {
      if (key.startsWith(`${connectionId}:`)) {
        this.inFlight.delete(key);
      }
    }

    for (const key of this.claiming) {
      if (key.startsWith(`${connectionId}:`)) {
        this.claiming.delete(key);
      }
    }

    await requeueMessagesForConnection(connectionId);
  }
}