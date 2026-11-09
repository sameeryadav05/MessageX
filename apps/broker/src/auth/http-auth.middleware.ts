
import type { RequestHandler } from "express";
import {
  getBrokerUserByUsername
} from "./auth.repository.js";
import { verifyPassword } from "./password.js";

const MAX_AUTH_HEADER_LENGTH = 2048;

function rejectAuthentication(
  res: Parameters<RequestHandler>[1]
): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="MessageX"');

  res.status(401).json({
    success: false,
    error: {
      code: "ERR_UNAUTHORIZED",
      message: "Invalid or missing management credentials"
    }
  });
}

export const requireManagementAuth: RequestHandler = async (
  req,
  res,
  next
) => {
  const header = req.headers.authorization;

  if (
    !header ||
    header.length > MAX_AUTH_HEADER_LENGTH ||
    !header.startsWith("Basic ")
  ) {
    rejectAuthentication(res);
    return;
  }

  try {
    const encoded = header.slice(6);

    // Reject malformed Base64 instead of accepting partial decoding.
    if (
      !encoded ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
      encoded.length % 4 !== 0
    ) {
      rejectAuthentication(res);
      return;
    }

    const credentials = Buffer.from(
      encoded,
      "base64"
    ).toString("utf8");

    const separator = credentials.indexOf(":");

    if (separator <= 0) {
      rejectAuthentication(res);
      return;
    }

    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);

    if (
      !username ||
      username.length > 64 ||
      !password
    ) {
      rejectAuthentication(res);
      return;
    }

    const user = await getBrokerUserByUsername(username);

    if (!user) {
      rejectAuthentication(res);
      return;
    }

    const validPassword = await verifyPassword(
      password,
      user.password_hash
    );

    if (!validPassword) {
      rejectAuthentication(res);
      return;
    }

    next();
  } catch (error) {
    console.error(
      "[HTTP Auth] Authentication error:",
      error
    );

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Management authentication failed"
      }
    });
  }
};
