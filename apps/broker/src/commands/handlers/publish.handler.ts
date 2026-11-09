import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import { publishMessage } from "../../messages/message.repository.js";

import { brokerMetrics } from "../../monitoring/metrics.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handlePublish: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before publishing messages"
      }
    };
  }

  const { exchangeName, routingKey, message, headers } = command.payload;

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

  if (!Object.prototype.hasOwnProperty.call(command.payload, "message")) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_MISSING_MESSAGE",
        message: "A message payload is required"
      }
    };
  }

  if (
    headers !== undefined &&
    (
      typeof headers !== "object" ||
      headers === null ||
      Array.isArray(headers)
    )
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_HEADERS",
        message: "headers must be an object"
      }
    };
  }

  try {
    const result = await publishMessage({
      exchangeName: exchangeName.trim(),
      routingKey: (routingKey as string | undefined) ?? "",
      message,
      headers: headers as Record<string, unknown> | undefined
    });
    brokerMetrics.recordPublished(result.routedQueues);

    // Notify active consumers after messages are committed to PostgreSQL.
    await consumerManager.deliverAvailable(); 

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        exchangeName: result.exchangeName,
        routedQueues: result.routedQueues
      }
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Message publishing failed";

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_PUBLISH_FAILED",
        message
      }
    };

    
  }
};