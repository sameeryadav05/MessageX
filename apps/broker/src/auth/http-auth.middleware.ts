import type { RequestHandler } from "express";

import { getBrokerUserByUsername } from "./auth.repository.js";
import { verifyPassword } from "./password.js";
import { getManagementSessionUser } from "./session.repository.js";
import { hashSessionToken, readSessionCookie } from "./session.js";

const MAX_AUTH_HEADER_LENGTH = 2048;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function rejectAuthentication(res: Parameters<RequestHandler>[1]): void {
  res.status(401).json({
    success: false,
    error: {
      code: "ERR_UNAUTHORIZED",
      message: "Invalid or missing management credentials"
    }
  });
}

function hasValidSameOrigin(req: Parameters<RequestHandler>[0]): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const requireManagementAuth: RequestHandler = async (req, res, next) => {
  const sessionToken = readSessionCookie(req.headers.cookie);

  if (sessionToken) {
    try {
      const user = await getManagementSessionUser(hashSessionToken(sessionToken));
      if (user) {
        if (!SAFE_METHODS.has(req.method) && !hasValidSameOrigin(req)) {
          res.status(403).json({
            success: false,
            error: { code: "ERR_CSRF", message: "Invalid request origin" }
          });
          return;
        }
        res.locals.managementUser = user;
        next();
        return;
      }
    } catch (error) {
      console.error("[HTTP Auth] Session lookup failed:", error);
      res.status(500).json({
        success: false,
        error: { code: "ERR_INTERNAL", message: "Management authentication failed" }
      });
      return;
    }
  }

  const header = req.headers.authorization;
  if (!header || header.length > MAX_AUTH_HEADER_LENGTH || !header.startsWith("Basic ")) {
    rejectAuthentication(res);
    return;
  }

  try {
    const encoded = header.slice(6);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      rejectAuthentication(res);
      return;
    }

    const credentials = Buffer.from(encoded, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    if (separator <= 0) {
      rejectAuthentication(res);
      return;
    }

    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    if (!username || username.length > 64 || !password) {
      rejectAuthentication(res);
      return;
    }

    const user = await getBrokerUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      rejectAuthentication(res);
      return;
    }

    res.locals.managementUser = { id: user.id, username: user.username };
    next();
  } catch (error) {
    console.error("[HTTP Auth] Authentication error:", error);
    res.status(500).json({
      success: false,
      error: { code: "ERR_INTERNAL", message: "Management authentication failed" }
    });
  }
};
