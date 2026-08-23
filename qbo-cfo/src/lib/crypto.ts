import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { env } from './env';

/**
 * Envelope encryption for QuickBooks OAuth tokens.
 *
 * Format: v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 * AES-256-GCM with a 96-bit random IV per record.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'v1';

function loadKey(): Buffer {
  const raw = env().TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  // Accept base64 or hex; anything else is hashed to a deterministic 32 bytes.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const decoded = Buffer.from(raw, 'base64');
    key = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
  }
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must resolve to 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string, key?: Buffer): string {
  const k = key ?? loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string, key?: Buffer): string {
  const k = key ?? loadKey();
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Malformed encrypted payload');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, k, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// --------------------------------------------------------------------------
// Password hashing (scrypt; no native dependency required)
// --------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, { N, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --------------------------------------------------------------------------
// Opaque tokens (sessions, OAuth state)
// --------------------------------------------------------------------------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Redact anything that looks like a secret before it reaches a log sink.
 * Applied by the logger to every string value it emits.
 */
export function redact(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/("?(?:access|refresh|id)_token"?\s*[:=]\s*"?)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/("?client_secret"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1[redacted]')
    .replace(/(sk-[A-Za-z0-9]{6})[A-Za-z0-9_\-]+/g, '$1[redacted]');
}
