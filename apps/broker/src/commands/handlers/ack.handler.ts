import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { acknowledgeMessage } from "../../messages/message.repository.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handleAck: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before acknowledging messages"
      }
    };
  }

  const { deliveryTag } = command.payload;

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

  try {
    // Database verifies that this delivery belongs to this connection.
    const acknowledged = await acknowledgeMessage(
      deliveryTag,
      connection.id
    );

    if (!acknowledged) {
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

    // Release the prefetch slot only after the database ACK succeeds.
    const queueName = consumerManager.settleDelivery(
      connection.id,
      deliveryTag
    );

    // With prefetch=1, the next message can now be delivered.
    if (queueName) {
      await consumerManager.deliverNext(connection, queueName);
    }

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        deliveryTag,
        acknowledged: true,
        message: "Message acknowledged successfully"
      }
    };
  } catch (error) {
    console.error("[ACK] Failed to acknowledge message:", error);

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_ACK_FAILED",
        message: "Failed to acknowledge message"
      }
    };
  }
};