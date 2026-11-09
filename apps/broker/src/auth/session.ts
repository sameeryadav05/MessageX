import { createHash, randomBytes } from "node:crypto";

export const MANAGEMENT_SESSION_COOKIE = "messagex_session";
export const MANAGEMENT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name === MANAGEMENT_SESSION_COOKIE && /^[a-f0-9]{64}$/.test(value)) {
      return value;
    }
  }

  return null;
}

export function isSecureRequest(
  protocolHeader: string | undefined,
  encrypted: boolean
): boolean {
  return encrypted || protocolHeader?.split(",")[0]?.trim() === "https";
}
