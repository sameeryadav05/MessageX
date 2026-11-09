
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";

import {
  unbindQueueFromExchange
} from "../../bindings/binding.repository.js";

import {
  getQueueByName
} from "../../queues/queue.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleUnbind: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before removing a binding"
      }
    };
  }

  const {
    exchangeName,
    queueName,
    routingKey,
    arguments: bindingArguments
  } = command.payload;

  if (
    typeof exchangeName !== "string" ||
    exchangeName.trim().length === 0 ||
    exchangeName.length > 255
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_EXCHANGE_NAME",
        message: "A valid exchangeName is required"
      }
    };
  }

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
        message: "A valid queueName is required"
      }
    };
  }

  if (
    routingKey !== undefined &&
    (typeof routingKey !== "string" || routingKey.length > 255)
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_ROUTING_KEY",
        message: "routingKey must be a string of at most 255 characters"
      }
    };
  }

  if (
    bindingArguments !== undefined &&
    (
      typeof bindingArguments !== "object" ||
      bindingArguments === null ||
      Array.isArray(bindingArguments)
    )
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_BINDING_ARGUMENTS",
        message: "arguments must be an object"
      }
    };
  }

  try {
    const normalizedQueueName = queueName.trim();

    const queue = await getQueueByName(normalizedQueueName);

    if (
      queue?.exclusive &&
      queue.owner_connection_id !== connection.id
    ) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_EXCLUSIVE_QUEUE_ACCESS",
          message: "Only the declaring connection can modify bindings for this exclusive queue"
        }
      };
    }

    const removed = await unbindQueueFromExchange({
      exchangeName: exchangeName.trim(),
      queueName: normalizedQueueName,
      routingKey: (routingKey as string | undefined) ?? "",
      arguments:
        (bindingArguments as Record<string, unknown> | undefined) ?? {}
    });

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        exchangeName: exchangeName.trim(),
        queueName: normalizedQueueName,
        removed
      }
    };
  } catch (error) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_UNBIND_FAILED",
        message: error instanceof Error
          ? error.message
          : "Binding removal failed"
      }
    };
  }
};
