
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { releaseMessage } from "../../messages/message.repository.js";
import { brokerMetrics } from "../../monitoring/metrics.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handleNack: CommandHandlerFunction = async ({
  connection,
  command,
  consumerManager
}) => {
  // Client must be connected before rejecting messages.
  if (!connection.isConnected || connection.clientName === null) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_NOT_CONNECTED",
        message: "Client must CONNECT before rejecting messages"
      }
    };
  }

  const { deliveryTag, requeue = true } = command.payload;

  // Validate delivery tag.
  if (
    typeof deliveryTag !== "string" ||
    deliveryTag.trim().length === 0
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_DELIVERY_TAG",
        message: "A valid deliveryTag is required"
      }
    };
  }

  // Validate requeue option.
  if (typeof requeue !== "boolean") {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_REQUEUE",
        message: "requeue must be a boolean"
      }
    };
  }

  try {
    // Release the message and enforce retry/DLQ rules atomically.
    const result = await releaseMessage(
      deliveryTag,
      connection.id,
      requeue
    );

    if (!result.released) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_INVALID_DELIVERY_TAG",
          message: "Message was not found or does not belong to this connection"
        }
      };
    }

    // Record a successfully processed NACK.
    brokerMetrics.recordRejected();

    if (result.deadLettered) {
      brokerMetrics.recordDeadLettered();
    } else if (requeue) {
      brokerMetrics.recordRequeued();
    }

    // Release the consumer's prefetch slot after DB operation succeeds.
    const queueName = consumerManager.settleDelivery(
      connection.id,
      deliveryTag
    );

    if (queueName) {
      // Dispatch the destination queue if the message was moved to a DLQ
      // or returned to its original queue.
      if (result.destinationQueueName) {
        await consumerManager.dispatchQueue(
          result.destinationQueueName
        );
      }

      // If the message moved to a different queue, also dispatch the
      // source queue so its other ready messages can be delivered.
      if (
        result.sourceQueueName &&
        result.sourceQueueName !== result.destinationQueueName
      ) {
        await consumerManager.dispatchQueue(
          result.sourceQueueName
        );
      }
    }

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        deliveryTag,
        rejected: true,
        requeued: requeue && !result.deadLettered,
        deadLettered: result.deadLettered,
        sourceQueue: result.sourceQueueName,
        destinationQueue: result.destinationQueueName,
        message: result.deadLettered
          ? result.destinationQueueName
            ? "Message rejected and moved to dead-letter queue"
            : "Message rejected and marked as dead"
          : requeue
            ? "Message rejected and requeued"
            : "Message rejected and discarded"
      }
    };
  } catch (error) {
    console.error("[NACK] Failed to reject message:", error);

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_NACK_FAILED",
        message: "Failed to reject message"
      }
    };
  }
};
