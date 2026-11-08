
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";

import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;

export async function hashPassword(
  password: string
): Promise<string> {
  if (password.length < 8) {
    throw new Error("Password must contain at least 8 characters");
  }

  const salt = randomBytes(16);

  const derivedKey = (await scrypt(
    password,
    salt,
    KEY_LENGTH
  )) as Buffer;

  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const [algorithm, saltHex, keyHex] = storedHash.split("$");

    if (
      algorithm !== "scrypt" ||
      !saltHex ||
      !keyHex ||
      !/^[0-9a-f]+$/i.test(saltHex) ||
      !/^[0-9a-f]+$/i.test(keyHex)
    ) {
      return false;
    }

    const salt = Buffer.from(saltHex, "hex");
    const expectedKey = Buffer.from(keyHex, "hex");

    if (expectedKey.length !== KEY_LENGTH) {
      return false;
    }

    const actualKey = (await scrypt(
      password,
      salt,
      KEY_LENGTH
    )) as Buffer;

    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}
