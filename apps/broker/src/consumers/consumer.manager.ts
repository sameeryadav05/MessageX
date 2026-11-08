
import { randomUUID } from "node:crypto";

import type { ClientConnection } from "../connection/client-connection.js";

import {
  claimNextMessage,
  requeueMessagesForConnection,
  rejectMessage,
  requeueExpiredMessages
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

  // One active claim per connection + queue.
  private readonly claiming = new Set<string>();

  // One unacknowledged message per consumer (prefetch = 1).
  private readonly inFlight = new Map<string, string>();

  // Tracks deliveryTag -> queueName, even after CANCEL.
  private readonly deliveryQueues = new Map<string, string>();

  // Last consumer that received a message from each queue.
  private readonly lastDispatched = new Map<string, string>();

  // Prevents concurrent dispatch loops for the same queue.
  private readonly dispatching = new Set<string>();

  // Requests another dispatch pass if a notification arrives mid-loop.
  private readonly dispatchRequested = new Set<string>();

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

  /**
 * Recovers messages that were not acknowledged before the timeout.
 */
async recoverExpiredDeliveries(
  timeoutSeconds: number
): Promise<number> {
  const expiredDeliveries = await requeueExpiredMessages(timeoutSeconds);

  const affectedQueues = new Set<string>();

  for (const delivery of expiredDeliveries) {
    const key = this.getKey(
      delivery.connectionId,
      delivery.queueName
    );

    // Release the slot only if it still belongs to this delivery.
    if (this.inFlight.get(key) === delivery.deliveryTag) {
      this.inFlight.delete(key);
    }

    this.deliveryQueues.delete(delivery.deliveryTag);
    affectedQueues.add(delivery.queueName);
  }

  // Make recovered messages available to active consumers.
  await Promise.all(
    [...affectedQueues].map((queueName) =>
      this.dispatchQueue(queueName)
    )
  );

  if (expiredDeliveries.length > 0) {
    console.log(
      `[Consumer] Recovered ${expiredDeliveries.length} expired deliveries`
    );
  }

  return expiredDeliveries.length;
}
  

  isSubscribed(connectionId: string, queueName: string): boolean {
    return this.subscriptions.get(connectionId)?.has(queueName) ?? false;
  }

  /**
   * Returns all currently registered subscriptions for a queue.
   * Map insertion order provides a stable base ordering.
   */
  private getQueueSubscriptions(
    queueName: string
  ): ConsumerSubscription[] {
    const result: ConsumerSubscription[] = [];

    for (const subscriptions of this.subscriptions.values()) {
      const subscription = subscriptions.get(queueName);

      if (subscription) {
        result.push(subscription);
      }
    }

    return result;
  }

  /**
   * Finds the next eligible consumer after the last consumer
   * that received a message from this queue.
   */
  private getNextEligibleConsumer(
    queueName: string
  ): ConsumerSubscription | null {
    const subscriptions = this.getQueueSubscriptions(queueName);

    if (subscriptions.length === 0) {
      return null;
    }

    const lastConnectionId = this.lastDispatched.get(queueName);

    const lastIndex = subscriptions.findIndex(
      (subscription) => subscription.connection.id === lastConnectionId
    );

    const startIndex = lastIndex === -1
      ? 0
      : (lastIndex + 1) % subscriptions.length;

    for (let offset = 0; offset < subscriptions.length; offset++) {
      const index = (startIndex + offset) % subscriptions.length;
      const subscription = subscriptions[index];

      const connectionId = subscription.connection.id;
      const key = this.getKey(connectionId, queueName);

      if (
        subscription.connection.isConnected &&
        this.isSubscribed(connectionId, queueName) &&
        !this.claiming.has(key) &&
        !this.inFlight.has(key)
      ) {
        return subscription;
      }
    }

    return null;
  }

  /**
   * Claims and sends one message to the selected consumer.
   *
   * Returns:
   * - "delivered": a message was delivered
   * - "empty": no ready message exists
   * - "skipped": the selected consumer became unavailable
   */
  private async deliverToConsumer(
    subscription: ConsumerSubscription
  ): Promise<"delivered" | "empty" | "skipped"> {
    const { connection, queueName } = subscription;
    const connectionId = connection.id;
    const key = this.getKey(connectionId, queueName);

    if (
      !connection.isConnected ||
      !this.isSubscribed(connectionId, queueName) ||
      this.claiming.has(key) ||
      this.inFlight.has(key)
    ) {
      return "skipped";
    }

    this.claiming.add(key);

    let claimedDeliveryTag: string | null = null;

    try {
      const message = await claimNextMessage(queueName, connectionId);

      if (!message) {
        return "empty";
      }

      claimedDeliveryTag = message.deliveryTag;

      // The consumer may have cancelled while the DB claim was running.
      if (!this.isSubscribed(connectionId, queueName)) {
        await rejectMessage(message.deliveryTag, connectionId, true);
        return "skipped";
      }

      if (!connection.isConnected) {
        await requeueMessagesForConnection(connectionId);
        return "skipped";
      }

      this.inFlight.set(key, message.deliveryTag);
      this.deliveryQueues.set(message.deliveryTag, queueName);

      connection.send({
        version: 1,
        type: "EVENT",
        event: "MESSAGE_DELIVERED",
        payload: {
          consumerTag: subscription.consumerTag,
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

      this.lastDispatched.set(queueName, connectionId);

      return "delivered";
    } catch (error) {
      console.error(
        `[Consumer] Failed to deliver message from queue '${queueName}':`,
        error
      );

      if (claimedDeliveryTag) {
        try {
          await rejectMessage(
            claimedDeliveryTag,
            connectionId,
            true
          );
        } catch (requeueError) {
          console.error(
            `[Consumer] Failed to requeue message '${claimedDeliveryTag}':`,
            requeueError
          );
        }
      }

      this.inFlight.delete(key);

      if (claimedDeliveryTag) {
        this.deliveryQueues.delete(claimedDeliveryTag);
      }

      return "skipped";
    } finally {
      this.claiming.delete(key);
    }
  }

  /**
   * Runs a serialized round-robin dispatch loop for one queue.
   */
  async dispatchQueue(queueName: string): Promise<void> {
    this.dispatchRequested.add(queueName);

    if (this.dispatching.has(queueName)) {
      return;
    }

    this.dispatching.add(queueName);

    try {
      do {
        this.dispatchRequested.delete(queueName);

        while (true) {
          const subscription = this.getNextEligibleConsumer(queueName);

          if (!subscription) {
            break;
          }

          const result = await this.deliverToConsumer(subscription);

          if (result === "empty") {
            break;
          }

          // If a consumer became unavailable during the claim,
          // continue and give another eligible consumer a chance.
        }
      } while (this.dispatchRequested.has(queueName));
    } finally {
      this.dispatching.delete(queueName);
    }

    // If another request arrived at the boundary of loop cleanup,
    // schedule another pass.
    if (this.dispatchRequested.has(queueName)) {
      await this.dispatchQueue(queueName);
    }
  }

  /**
   * Compatibility method for existing command handlers.
   * Dispatches the queue through the round-robin scheduler.
   */
  async deliverNext(
    _connection: ClientConnection,
    queueName: string
  ): Promise<boolean> {
    await this.dispatchQueue(queueName);
    return true;
  }

  /**
   * Releases a consumer's prefetch slot after ACK/NACK.
   * Works even if the consumer subscription was cancelled.
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
    const subscriptions = this.subscriptions.get(connectionId);

    const affectedQueues = new Set<string>();

    if (subscriptions) {
      for (const queueName of subscriptions.keys()) {
        affectedQueues.add(queueName);
      }
    }

    for (const [key, deliveryTag] of this.inFlight) {
      if (key.startsWith(`${connectionId}:`)) {
        const queueName = this.deliveryQueues.get(deliveryTag);

        if (queueName) {
          affectedQueues.add(queueName);
        }

        this.inFlight.delete(key);
        this.deliveryQueues.delete(deliveryTag);
      }
    }

    this.subscriptions.delete(connectionId);

    await requeueMessagesForConnection(connectionId);

    // Give remaining consumers a chance to receive requeued messages.
    for (const queueName of affectedQueues) {
      await this.dispatchQueue(queueName);
    }
  }

  /**
   * Dispatches all queues that currently have active subscriptions.
   */
  async deliverAvailable(
    excludeConnectionId?: string
  ): Promise<void> {
    const queueNames = new Set<string>();

    for (const [connectionId, subscriptions] of this.subscriptions) {
      if (connectionId === excludeConnectionId) {
        continue;
      }

      for (const queueName of subscriptions.keys()) {
        queueNames.add(queueName);
      }
    }

    await Promise.all(
      [...queueNames].map((queueName) => this.dispatchQueue(queueName))
    );
  }
}
