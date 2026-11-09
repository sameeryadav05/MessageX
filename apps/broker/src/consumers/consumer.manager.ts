
import { randomUUID } from "node:crypto";

import type { ClientConnection } from "../connection/client-connection.js";

import {
  claimNextMessage,
  releaseMessage,
  requeueExpiredMessages
} from "../messages/message.repository.js";

interface ConsumerSubscription {
  consumerTag: string;
  queueName: string;
  connection: ClientConnection;
}

type DeliveryResult = "delivered" | "empty" | "skipped";

export class ConsumerManager {
  private readonly subscriptions = new Map<
    string,
    Map<string, ConsumerSubscription>
  >();

  // One active claim per connection + queue.
  private readonly claiming = new Set<string>();

  // One unacknowledged message per connection + queue (prefetch = 1).
  private readonly inFlight = new Map<string, string>();

  // Tracks deliveryTag -> queueName, including after CANCEL.
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

  private async dispatchAffectedQueues(
    sourceQueueName: string | null,
    destinationQueueName: string | null
  ): Promise<void> {
    const queues = new Set<string>();

    if (sourceQueueName) {
      queues.add(sourceQueueName);
    }

    if (destinationQueueName) {
      queues.add(destinationQueueName);
    }

    await Promise.all(
      [...queues].map((queueName) => this.dispatchQueue(queueName))
    );
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
   * Recovers messages whose acknowledgement deadline has expired.
   * Retry limits and dead-letter routing are handled by the repository.
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

      // Release the prefetch slot only if it still belongs to this delivery.
      if (this.inFlight.get(key) === delivery.deliveryTag) {
        this.inFlight.delete(key);
      }

      this.deliveryQueues.delete(delivery.deliveryTag);

      // Dispatch the source queue and the destination DLQ, if applicable.
      affectedQueues.add(delivery.queueName);

      if (delivery.destinationQueueName) {
        affectedQueues.add(delivery.destinationQueueName);
      }
    }

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
   * Returns all registered subscriptions for a queue.
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
   * Finds the next eligible consumer using round-robin ordering.
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

    const startIndex =
      lastIndex === -1
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
   */
  private async deliverToConsumer(
    subscription: ConsumerSubscription
  ): Promise<DeliveryResult> {
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

      // The consumer may have cancelled while the database claim was running.
      if (!this.isSubscribed(connectionId, queueName)) {
        const result = await releaseMessage(
          message.deliveryTag,
          connectionId,
          true
        );

        if (result.released) {
          await this.dispatchAffectedQueues(
            result.sourceQueueName,
            result.destinationQueueName
          );
        }

        return "skipped";
      }

      // The connection may have disconnected while the claim was running.
      if (!connection.isConnected) {
        const result = await releaseMessage(
          message.deliveryTag,
          connectionId,
          true
        );

        if (result.released) {
          await this.dispatchAffectedQueues(
            result.sourceQueueName,
            result.destinationQueueName
          );
        }

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
          const result = await releaseMessage(
            claimedDeliveryTag,
            connectionId,
            true
          );

          if (result.released) {
            await this.dispatchAffectedQueues(
              result.sourceQueueName,
              result.destinationQueueName
            );
          }
        } catch (releaseError) {
          console.error(
            `[Consumer] Failed to release message '${claimedDeliveryTag}':`,
            releaseError
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

          // A skipped consumer may have become unavailable during the claim.
          // Continue so another eligible consumer gets a chance.
        }
      } while (this.dispatchRequested.has(queueName));
    } finally {
      this.dispatching.delete(queueName);
    }

    // Handle a dispatch request arriving while the loop was being cleaned up.
    if (this.dispatchRequested.has(queueName)) {
      await this.dispatchQueue(queueName);
    }
  }

  /**
   * Compatibility method for existing command handlers.
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
   * Also works after the subscription has been cancelled.
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
   * Removes subscriptions and recovers all tracked in-flight messages.
   * Each message passes through releaseMessage so retry limits and DLQs apply.
   */
  async removeConnection(connectionId: string): Promise<void> {
    const subscriptions = this.subscriptions.get(connectionId);
    const affectedQueues = new Set<string>();

    if (subscriptions) {
      for (const queueName of subscriptions.keys()) {
        affectedQueues.add(queueName);
      }
    }

    const deliveriesToRelease: Array<{
      queueName: string;
      deliveryTag: string;
    }> = [];

    for (const [key, deliveryTag] of this.inFlight) {
      if (!key.startsWith(`${connectionId}:`)) {
        continue;
      }

      const queueName = this.deliveryQueues.get(deliveryTag);

      if (queueName) {
        affectedQueues.add(queueName);
        deliveriesToRelease.push({ queueName, deliveryTag });
      }

      this.inFlight.delete(key);
      this.deliveryQueues.delete(deliveryTag);
    }

    this.subscriptions.delete(connectionId);

    for (const delivery of deliveriesToRelease) {
      try {
        const result = await releaseMessage(
          delivery.deliveryTag,
          connectionId,
          true
        );

        if (result.released) {
          if (result.sourceQueueName) {
            affectedQueues.add(result.sourceQueueName);
          }

          if (result.destinationQueueName) {
            affectedQueues.add(result.destinationQueueName);
          }
        }
      } catch (error) {
        console.error(
          `[Consumer] Failed to recover delivery '${delivery.deliveryTag}' after disconnect:`,
          error
        );
      }
    }

    // Give remaining consumers a chance to receive recovered messages.
    await Promise.all(
      [...affectedQueues].map((queueName) =>
        this.dispatchQueue(queueName)
      )
    );
  }

  /**
   * Dispatches queues that have active subscriptions.
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
      [...queueNames].map((queueName) =>
        this.dispatchQueue(queueName)
      )
    );
  }

  
  /**
   * Removes all in-memory consumer state associated with a deleted queue.
   */
  removeQueue(queueName: string): void {
    // Remove subscriptions for this queue.
    for (const [connectionId, subscriptions] of this.subscriptions) {
      subscriptions.delete(queueName);

      if (subscriptions.size === 0) {
        this.subscriptions.delete(connectionId);
      }
    }

    // Remove in-flight delivery tracking.
    for (const [key, deliveryTag] of this.inFlight) {
      if (key.endsWith(`:${queueName}`)) {
        this.inFlight.delete(key);
        this.deliveryQueues.delete(deliveryTag);
      }
    }

    // Clear queue-specific dispatch state.
    this.lastDispatched.delete(queueName);
    this.dispatchRequested.delete(queueName);
  }




}
