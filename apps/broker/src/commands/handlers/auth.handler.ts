
import { PROTOCOL_VERSION } from "../../protocol/protocol.constants.js";

import { getBrokerUserByUsername } from "../../auth/auth.repository.js";
import { verifyPassword } from "../../auth/password.js";

import type { CommandHandlerFunction } from "../command.types.js";

export const handleAuth: CommandHandlerFunction = async ({
  connection,
  command
}) => {
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

  if (connection.clientName === null) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_CONNECT_REQUIRED",
        message: "Send CONNECT before AUTH"
      }
    };
  }

  if (connection.isAuthenticated) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_ALREADY_AUTHENTICATED",
        message: "This connection is already authenticated"
      }
    };
  }

  const { username, password } = command.payload;

  if (
    typeof username !== "string" ||
    username.trim().length === 0 ||
    username.length > 64 ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_INVALID_CREDENTIALS",
        message: "A valid username and password are required"
      }
    };
  }

  try {
    const normalizedUsername = username.trim();

    const user = await getBrokerUserByUsername(normalizedUsername);

    if (!user) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_AUTH_FAILED",
          message: "Invalid username or password"
        }
      };
    }

    const validPassword = await verifyPassword(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return {
        version: PROTOCOL_VERSION,
        type: "RESPONSE",
        requestId: command.requestId,
        success: false,
        error: {
          code: "ERR_AUTH_FAILED",
          message: "Invalid username or password"
        }
      };
    }

    connection.authenticate(user.username);

    console.log(
      `[AUTH] User '${user.username}' authenticated on connection ${connection.id}`
    );

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: true,
      payload: {
        authenticated: true,
        username: user.username,
        connectionId: connection.id,
        message: "Authentication successful"
      }
    };
  } catch (error) {
    console.error("[AUTH] Authentication failed:", error);

    return {
      version: PROTOCOL_VERSION,
      type: "RESPONSE",
      requestId: command.requestId,
      success: false,
      error: {
        code: "ERR_AUTH_INTERNAL",
        message: "Authentication service unavailable"
      }
    };
  }
};
