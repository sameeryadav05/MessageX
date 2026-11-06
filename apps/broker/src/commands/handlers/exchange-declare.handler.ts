import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import {
  declareExchange,
  type ExchangeType
} from "../../exchanges/exchange.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

const ALLOWED_EXCHANGE_TYPES: ExchangeType[] = [
  "direct",
  "fanout",
  "topic",
  "headers"
];

export const handleExchangeDeclare: CommandHandlerFunction = async ({
  connection,
  command
}) => {
  // Client must CONNECT before declaring exchanges.
  if (!connection.isConnected || connection.clientName === null) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_NOT_CONNECTED",
        message: "Client must CONNECT before declaring an exchange"
      }
    };
  }

  const { name, type, durable } = command.payload;

  // Validate exchange name.
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
        code: "ERR_INVALID_EXCHANGE_NAME",
        message: "Exchange name must be a non-empty string of at most 255 characters"
      }
    };
  }

  // Validate exchange type.
  if (
    typeof type !== "string" ||
    !ALLOWED_EXCHANGE_TYPES.includes(type as ExchangeType)
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_EXCHANGE_TYPE",
        message: "Exchange type must be direct, fanout, topic or headers"
      }
    };
  }

  // Validate durable option.
  if (durable !== undefined && typeof durable !== "boolean") {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_EXCHANGE_OPTIONS",
        message: "durable must be a boolean value"
      }
    };
  }

  try {
    const exchange = await declareExchange({
      name: name.trim(),
      type: type as ExchangeType,
      durable: durable as boolean | undefined
    });

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        exchange: {
          id: exchange.id,
          name: exchange.name,
          type: exchange.type,
          durable: exchange.durable
        }
      }
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Exchange declaration failed";

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_EXCHANGE_DECLARE_FAILED",
        message
      }
    };
  }
};