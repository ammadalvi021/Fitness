/**
 * Encryption for health-sync OAuth tokens at rest (V20 Feature 6).
 *
 * Tokens from Google's OAuth flow are PII-adjacent credentials: they must
 * never be stored in plaintext. This module wraps them in AES-256-GCM with a
 * server-held key from the HEALTH_SYNC_SECRET environment variable.
 *
 * Key format: 64 lowercase hex characters (32 bytes). Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Payload format: base64url(iv) + "." + base64url(ciphertext+authTag).
 * Authenticated encryption: a tampered or wrong-key payload fails closed
 * with a generic error (never leaks which half was wrong).
 */
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function keyBytes(): Buffer {
  const secret = process.env.HEALTH_SYNC_SECRET;
  if (!secret) {
    throw new Error('HEALTH_SYNC_SECRET is not set');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('HEALTH_SYNC_SECRET must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(secret, 'hex');
}

function b64uEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function b64uDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Encrypt a short secret (OAuth access/refresh token). */
export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error('Nothing to encrypt');
  const key = keyBytes();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64uEncode(iv)}.${b64uEncode(Buffer.concat([ct, tag]))}`;
}

/** Decrypt a payload produced by encryptToken. Throws on wrong key/tampering. */
export function decryptToken(payload: string): string {
  const key = keyBytes();
  const [ivB64, dataB64] = (payload ?? '').split('.');
  if (!ivB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const iv = b64uDecode(ivB64);
  const data = b64uDecode(dataB64);
  if (iv.length !== IV_BYTES || data.length < 17) {
    throw new Error('Malformed encrypted payload');
  }
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** True when token storage is possible (secret present and well-formed). */
export function healthCryptoConfigured(): boolean {
  try {
    keyBytes();
    return true;
  } catch {
    return false;
  }
}
