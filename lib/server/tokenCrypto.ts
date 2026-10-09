import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for stored OAuth refresh tokens. TOKEN_ENCRYPTION_KEY is 32 random bytes, base64 encoded.
// Format: v1.<iv>.<tag>.<ciphertext>, each part base64url. The key never leaves the server.

export class TokenKeyError extends Error {}

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY is not set.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new TokenKeyError("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return k;
}

export const tokenKeyReady = () => { try { key(); return true; } catch { return false; } };

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable stored token.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
