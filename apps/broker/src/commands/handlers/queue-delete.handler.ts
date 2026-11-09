
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";

import {
  deleteQueue,
  getQueueByName
} from "../../queues/queue.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleQueueDelete: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before deleting a queue"
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
    const normalizedName = queueName.trim();

    const queue = await getQueueByName(normalizedName);

    if (!queue) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_QUEUE_NOT_FOUND",
          message: `Queue '${normalizedName}' does not exist`
        }
      };
    }

    // Only the owner connection can delete an exclusive queue.
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
          message: "Only the declaring connection can delete this exclusive queue"
        }
      };
    }

    const deleted = await deleteQueue(normalizedName);

    if (deleted) {
      consumerManager.removeQueue(normalizedName);
    }

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        queueName: normalizedName,
        deleted
      }
    };
  } catch (error) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_QUEUE_DELETE_FAILED",
        message: error instanceof Error
          ? error.message
          : "Queue deletion failed"
      }
    };
  }
};
