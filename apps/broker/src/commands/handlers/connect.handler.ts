
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

  // Return a successful CONNECT response.
  return {
    version: PROTOCOL_VERSION,
    type: "RESPONSE",
    requestId: command.requestId,
    success: true,
    payload: {
      connectionId: connection.id,
      clientName: clientName.trim(),
      protocolVersion: PROTOCOL_VERSION
    }
  };
};
