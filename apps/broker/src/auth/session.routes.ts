import { Router } from "express";
import { getBrokerUserByUsername } from "./auth.repository.js";
import { verifyPassword } from "./password.js";
import {
  createManagementSession,
  getManagementSessionUser,
  revokeManagementSession
} from "./session.repository.js";
import {
  createSessionToken,
  hashSessionToken,
  isSecureRequest,
  MANAGEMENT_SESSION_COOKIE,
  MANAGEMENT_SESSION_TTL_MS,
  readSessionCookie
} from "./session.js";

const router = Router();
const COOKIE_PATH = "/";

function isSameOrigin(req: Parameters<typeof router.post>[1] extends never ? never : any): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function setSessionCookie(req: any, res: any, token: string): void {
  const secure = isSecureRequest(req.get("x-forwarded-proto"), Boolean(req.secure));
  res.cookie(MANAGEMENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: MANAGEMENT_SESSION_TTL_MS
  });
}

function clearSessionCookie(req: any, res: any): void {
  const secure = isSecureRequest(req.get("x-forwarded-proto"), Boolean(req.secure));
  res.clearCookie(MANAGEMENT_SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: COOKIE_PATH
  });
}

router.post("/login", async (req, res) => {
  if (!isSameOrigin(req)) {
    res.status(403).json({ success: false, error: { code: "ERR_CSRF", message: "Invalid request origin" } });
    return;
  }

  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || username.length > 64 || !password || password.length > 128) {
    res.status(400).json({ success: false, error: { code: "ERR_INVALID_CREDENTIALS", message: "Username and password are required" } });
    return;
  }

  try {
    const user = await getBrokerUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ success: false, error: { code: "ERR_UNAUTHORIZED", message: "Invalid username or password" } });
      return;
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + MANAGEMENT_SESSION_TTL_MS);
    await createManagementSession(user.id, tokenHash, expiresAt);
    setSessionCookie(req, res, token);

    res.status(200).json({
      success: true,
      user: { id: user.id, username: user.username },
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error("[HTTP Auth] Login failed:", error);
    res.status(500).json({ success: false, error: { code: "ERR_INTERNAL", message: "Unable to sign in" } });
  }
});

router.get("/session", async (req, res) => {
  const token = readSessionCookie(req.headers.cookie);
  if (!token) {
    res.status(401).json({ success: false, error: { code: "ERR_UNAUTHORIZED", message: "No active session" } });
    return;
  }

  try {
    const user = await getManagementSessionUser(hashSessionToken(token));
    if (!user) {
      clearSessionCookie(req, res);
      res.status(401).json({ success: false, error: { code: "ERR_SESSION_EXPIRED", message: "Session expired" } });
      return;
    }
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("[HTTP Auth] Session check failed:", error);
    res.status(500).json({ success: false, error: { code: "ERR_INTERNAL", message: "Unable to validate session" } });
  }
});

router.post("/logout", async (req, res) => {
  if (!isSameOrigin(req)) {
    res.status(403).json({ success: false, error: { code: "ERR_CSRF", message: "Invalid request origin" } });
    return;
  }

  const token = readSessionCookie(req.headers.cookie);
  try {
    if (token) await revokeManagementSession(hashSessionToken(token));
    clearSessionCookie(req, res);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("[HTTP Auth] Logout failed:", error);
    res.status(500).json({ success: false, error: { code: "ERR_INTERNAL", message: "Unable to sign out" } });
  }
});

export default router;
