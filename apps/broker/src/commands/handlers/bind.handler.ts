
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { bindQueueToExchange } from "../../bindings/binding.repository.js";
import { getQueueByName } from "../../queues/queue.repository.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handleBind: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before creating a binding"
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
        message: "exchangeName must be a non-empty string of at most 255 characters"
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
        message: "queueName must be a non-empty string of at most 255 characters"
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

  const normalizedArguments =
    (bindingArguments as Record<string, unknown> | undefined) ?? {};

  if (Object.keys(normalizedArguments).length > 32) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_BINDING_ARGUMENTS",
        message: "A binding can contain at most 32 arguments"
      }
    };
  }

  const matchMode = normalizedArguments["x-match"];

  if (
    matchMode !== undefined &&
    matchMode !== "all" &&
    matchMode !== "any"
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_BINDING_ARGUMENTS",
        message: "x-match must be either 'all' or 'any'"
      }
    };
  }

  try {
    const normalizedQueueName = queueName.trim();
    const queue = await getQueueByName(normalizedQueueName);

    // Only the owner can create bindings for an exclusive queue.
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
          message: "Only the declaring connection can bind an exclusive queue"
        }
      };
    }

    const binding = await bindQueueToExchange({
      exchangeName: exchangeName.trim(),
      queueName: normalizedQueueName,
      routingKey: (routingKey as string | undefined) ?? "",
      arguments: normalizedArguments
    });

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        binding: {
          id: binding.id,
          exchangeName: binding.exchange_name,
          queueName: binding.queue_name,
          routingKey: binding.routing_key,
          arguments: binding.arguments
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Binding creation failed";

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_BIND_FAILED",
        message
      }
    };
  }
};
