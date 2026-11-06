import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { bindQueueToExchange } from "../../bindings/binding.repository.js";

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

  const { exchangeName, queueName, routingKey } = command.payload;

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

  try {
    const binding = await bindQueueToExchange({
      exchangeName: exchangeName.trim(),
      queueName: queueName.trim(),
      routingKey: (routingKey as string | undefined) ?? ""
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
          routingKey: binding.routing_key
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