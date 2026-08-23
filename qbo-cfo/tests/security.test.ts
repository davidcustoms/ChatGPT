import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  constantTimeEquals,
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  redact,
  sha256,
  verifyPassword,
} from '@/lib/crypto';
import { sanitizeText } from '@/lib/api';

const KEY = randomBytes(32);

describe('token encryption at rest', () => {
  it('round-trips a refresh token', () => {
    const token = 'AB11730000000abcdefghijklmnopqrstuvwxyz';
    const sealed = encryptSecret(token, KEY);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, KEY)).toBe(token);
  });

  it('uses a fresh IV so the same plaintext never produces the same ciphertext', () => {
    const a = encryptSecret('same-token', KEY);
    const b = encryptSecret('same-token', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const sealed = encryptSecret('token', KEY);
    const parts = sealed.split(':');
    const flipped = Buffer.from(parts[3] as string, 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const tampered = [parts[0], parts[1], parts[2], flipped.toString('base64')].join(':');
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('rejects decryption under the wrong key', () => {
    const sealed = encryptSecret('token', KEY);
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-a-payload', KEY)).toThrow(/Malformed/);
  });
});

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('salts each hash so identical passwords differ at rest', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('never stores the plaintext', () => {
    expect(hashPassword('hunter2-long-enough')).not.toContain('hunter2');
  });

  it('rejects a corrupted hash record instead of throwing', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('generates unpredictable, URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically for storage', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    // Only the digest is ever stored, never the token itself.
    expect(sha256('abc')).toHaveLength(64);
  });

  it('compares in constant time without leaking on length', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});

describe('log redaction', () => {
  it('removes bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('Authorization: Bearer [redacted]');
  });

  it('removes OAuth token fields', () => {
    const line = '{"access_token":"AB11730000abc","refresh_token":"AB21730000def"}';
    const cleaned = redact(line);
    expect(cleaned).not.toContain('AB11730000abc');
    expect(cleaned).not.toContain('AB21730000def');
  });

  it('removes the client secret and API keys', () => {
    expect(redact('client_secret=supersecretvalue')).not.toContain('supersecretvalue');
    expect(redact('sk-abcdefGHIJKLmnopqrstuvwx')).not.toContain('mnopqrstuvwx');
  });
});

describe('input sanitisation', () => {
  it('strips control characters', () => {
    expect(sanitizeText('hello\u0000\u0007world')).toBe('hello world');
    expect(sanitizeText('line\u001bbreak')).toBe('line break');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeText('  a    b  ')).toBe('a b');
  });

  it('enforces a maximum length', () => {
    expect(sanitizeText('x'.repeat(5_000), 100)).toHaveLength(100);
  });
});
