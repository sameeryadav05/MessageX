
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";

import {
  deleteExchange
} from "../../exchanges/exchange.repository.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleExchangeDelete: CommandHandlerFunction = async ({
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
        message: "Client must CONNECT before deleting an exchange"
      }
    };
  }

  const { exchangeName } = command.payload;

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

  try {
    const normalizedName = exchangeName.trim();

    const deleted = await deleteExchange(normalizedName);

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        exchangeName: normalizedName,
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
        code: "ERR_EXCHANGE_DELETE_FAILED",
        message: error instanceof Error
          ? error.message
          : "Exchange deletion failed"
      }
    };
  }
};
