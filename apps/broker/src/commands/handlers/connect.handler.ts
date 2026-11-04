
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";
import type { CommandHandlerFunction } from "../command.types.js";

export const handleConnect: CommandHandlerFunction = ({
  connection,
  command
}) => {
  const clientName = command.payload.clientName;

  // Validate the client name.
  if (
    typeof clientName !== "string" ||
    clientName.trim().length === 0 ||
    clientName.length > 64
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_CLIENT_NAME",
        message: "Client name must be a non-empty string of at most 64 characters"
      }
    };
  }

  const normalizedClientName = clientName.trim();

  // Ensure the connection is still active.
  if (!connection.isConnected) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_CONNECTION_CLOSED",
        message: "Connection is no longer active"
      }
    };
  }

  // Prevent changing identity on an already registered connection.
  if (
    connection.clientName !== null &&
    connection.clientName !== normalizedClientName
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_ALREADY_CONNECTED",
        message: "This connection is already registered with another client name"
      }
    };
  }

  // Save the client's identity in the connection.
  connection.registerClient(normalizedClientName);

  return {
    version: PROTOCOL_VERSION,
    type: "RESPONSE",
    requestId: command.requestId,
    success: true,
    payload: {
      connectionId: connection.id,
      clientName: connection.clientName,
      protocolVersion: PROTOCOL_VERSION
    }
  };
};
