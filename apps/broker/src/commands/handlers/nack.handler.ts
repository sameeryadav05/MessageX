import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { rejectMessage } from "../../messages/message.repository.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handleNack: CommandHandlerFunction = async ({
  connection,
  command,
  consumerManager
}) => {
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
    const rejected = await rejectMessage(
      deliveryTag,
      connection.id,
      requeue
    );

    if (!rejected) {
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

    const queueName = consumerManager.settleDelivery(
      connection.id,
      deliveryTag
    );

if (queueName) {
  if (requeue) {
    // Give other active consumers an opportunity first.
    await consumerManager.deliverAvailable(connection.id);
  } else {
    await consumerManager.dispatchQueue(queueName);
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
        requeued: requeue,
        message: requeue
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