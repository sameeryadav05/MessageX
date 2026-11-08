
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { declareQueue } from "../../queues/queue.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleQueueDeclare: CommandHandlerFunction = async ({
  connection,
  command
}) => {
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

  const {
    name,
    durable,
    exclusive,
    autoDelete,
    maxDeliveryCount,
    deadLetterQueue
  } = command.payload;

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

  if (
    maxDeliveryCount !== undefined &&
    (
      typeof maxDeliveryCount !== "number" ||
      !Number.isInteger(maxDeliveryCount) ||
      maxDeliveryCount < 1
    )
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_MAX_DELIVERY_COUNT",
        message: "maxDeliveryCount must be a positive integer"
      }
    };
  }

  if (
    deadLetterQueue !== undefined &&
    (
      typeof deadLetterQueue !== "string" ||
      deadLetterQueue.trim().length === 0 ||
      deadLetterQueue.length > 255
    )
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_DEAD_LETTER_QUEUE",
        message: "deadLetterQueue must be a non-empty queue name of at most 255 characters"
      }
    };
  }

  try {
    const normalizedName = name.trim();
    const normalizedDeadLetterQueue =
      typeof deadLetterQueue === "string"
        ? deadLetterQueue.trim()
        : undefined;

    const queue = await declareQueue({
      name: normalizedName,
      durable: durable as boolean | undefined,
      exclusive: exclusive as boolean | undefined,
      autoDelete: autoDelete as boolean | undefined,
      maxDeliveryCount: maxDeliveryCount as number | undefined,
      deadLetterQueue: normalizedDeadLetterQueue
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
          autoDelete: queue.auto_delete,
          maxDeliveryCount: queue.max_delivery_count,
          deadLetterQueue: queue.dead_letter_queue_name
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
