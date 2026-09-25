/**
 * @file crypto.ts
 * @description Cryptographic utilities: password hashing, comparison, secure token
 * and OTP generation. Built on bcryptjs and Node's built-in `crypto` module.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

/** Number of bcrypt salt rounds – high enough for security, low enough for perf */
const SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/**
 * Hash a plain-text password using bcrypt.
 *
 * @param password - Plain-text password from the user
 * @returns Bcrypt hash string safe to store in the database
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain-text password against a stored bcrypt hash.
 *
 * @param password - Plain-text candidate password
 * @param hash     - Stored bcrypt hash from the database
 * @returns `true` if the password matches, `false` otherwise
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Token / OTP generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random token encoded as a hex string.
 * Suitable for email verification links, password-reset tokens, etc.
 *
 * @param bytes - Number of random bytes to generate (default 32 → 64 hex chars)
 * @returns Hex-encoded random string
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a 6-digit numeric one-time password (OTP).
 * Note: for higher-security use cases, prefer `generateSecureToken` instead.
 *
 * @returns A 6-digit string, e.g. `"042819"`
 */
export function generateOTP(): string {
  // Use randomBytes to avoid Math.random bias
  const num = randomBytes(3).readUIntBE(0, 3) % 900000;
  return (100000 + num).toString();
}
