import "server-only";

import { env } from "@/server/env";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Key for stored secrets (mailbox passwords). Derived from SECRETS_ENCRYPTION_KEY, else BETTER_AUTH_SECRET. */
function key(): Buffer {
  const material = process.env.SECRETS_ENCRYPTION_KEY || env().BETTER_AUTH_SECRET;
  return createHash("sha256").update(material).digest();
}

/** AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** Returns null when the value can't be decrypted (e.g. the key changed). */
export function decryptSecret(stored: string): string | null {
  try {
    const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** What the UI may show about a stored secret: whether it exists and its last 4 characters. */
export function secretHint(plain: string | null | undefined): string | null {
  return plain ? plain.slice(-4) : null;
}
