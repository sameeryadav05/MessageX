import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { getQueueByName } from "../../queues/queue.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleConsume: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before consuming messages"
      }
    };
  }

  const { queueName } = command.payload;

  if (
    typeof queueName !== "string" ||
    queueName.trim().length === 0 ||
    queueName.length > 255
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_QUEUE_NAME",
        message: "queueName must be a non-empty string of at most 255 characters"
      }
    };
  }

  try {
    const normalizedQueueName = queueName.trim();
    const queue = await getQueueByName(normalizedQueueName);

    if (!queue) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_QUEUE_NOT_FOUND",
          message: `Queue '${normalizedQueueName}' does not exist`
        }
      };
    }

    // Exclusive queues can only be consumed by their owner connection.
    if (
      queue.exclusive &&
      queue.owner_connection_id !== connection.id
    ) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_EXCLUSIVE_QUEUE_ACCESS",
          message: "Only the declaring connection can consume from this exclusive queue"
        }
      };
    }

    const consumerTag = consumerManager.subscribe(
      connection,
      normalizedQueueName
    );

    // Deliver the first available message, if one exists.
    await consumerManager.dispatchQueue(normalizedQueueName);

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        consumerTag,
        queueName: normalizedQueueName,
        prefetchCount: 1,
        message: "Consumer registered successfully"
      }
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Consumer registration failed";

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_CONSUME_FAILED",
        message
      }
    };
  }
};