
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { declareQueue } from "../../queues/queue.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleQueueDeclare: CommandHandlerFunction = async ({
  connection,
  command
}) => {
  // Client must CONNECT before declaring queues.
  if (!connection.isConnected || connection.clientName === null) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_NOT_CONNECTED",
        message: "Client must CONNECT before declaring a queue"
      }
    };
  }

  const { name, durable, exclusive, autoDelete } = command.payload;

  // Validate queue name.
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > 255
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_QUEUE_NAME",
        message: "Queue name must be a non-empty string of at most 255 characters"
      }
    };
  }

  // Validate optional boolean settings.
  if (
    (durable !== undefined && typeof durable !== "boolean") ||
    (exclusive !== undefined && typeof exclusive !== "boolean") ||
    (autoDelete !== undefined && typeof autoDelete !== "boolean")
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_QUEUE_OPTIONS",
        message: "durable, exclusive and autoDelete must be boolean values"
      }
    };
  }

  try {
    const queue = await declareQueue({
      name: name.trim(),
      durable: durable as boolean | undefined,
      exclusive: exclusive as boolean | undefined,
      autoDelete: autoDelete as boolean | undefined
    });

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        queue: {
          id: queue.id,
          name: queue.name,
          durable: queue.durable,
          exclusive: queue.exclusive,
          autoDelete: queue.auto_delete
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Queue declaration failed";

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_QUEUE_DECLARE_FAILED",
        message
      }
    };
  }
};
