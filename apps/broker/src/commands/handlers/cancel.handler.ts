
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleCancel: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before cancelling a consumer"
      }
    };
  }

  const { consumerTag } = command.payload;

  if (
    typeof consumerTag !== "string" ||
    consumerTag.trim().length === 0
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_CONSUMER_TAG",
        message: "A valid consumerTag is required"
      }
    };
  }

  const queueName = consumerManager.cancel(
    connection.id,
    consumerTag
  );

  if (!queueName) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_CONSUMER_NOT_FOUND",
        message: "Consumer subscription was not found"
      }
    };
  }

  await consumerManager.dispatchQueue(queueName);

  return {
    version: PROTOCOL_VERSION,
    type: "RESPONSE",
    requestId: command.requestId,
    success: true,
    payload: {
      consumerTag,
      queueName,
      cancelled: true,
      message: "Consumer subscription cancelled successfully"
    }
  };
};
