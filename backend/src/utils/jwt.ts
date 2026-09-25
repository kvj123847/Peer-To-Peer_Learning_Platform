/**
 * @file jwt.ts
 * @description JWT utility functions for generating and verifying access and refresh tokens.
 * Access tokens are short-lived (15 minutes); refresh tokens are long-lived (7 days).
 */

import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/config/env';

// ---------------------------------------------------------------------------
// Token payload interfaces
// ---------------------------------------------------------------------------

/** Payload embedded inside a signed access token */
export interface AccessTokenPayload {
  /** userId */
  sub: string;
  email: string;
  ageTier: string;
  roles: string[];
  type: 'access';
}

/** Payload embedded inside a signed refresh token */
export interface RefreshTokenPayload {
  /** userId */
  sub: string;
  /** Unique token ID used for blacklisting / rotation */
  jti: string;
  type: 'refresh';
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generate a short-lived access token (15 minutes).
 *
 * @param payload - User identity data to embed in the token
 * @returns Signed JWT string
 */
export function generateAccessToken(
  payload: Omit<AccessTokenPayload, 'type'>,
): string {
  const claims: AccessTokenPayload = { ...payload, type: 'access' };
  const options: SignOptions = {
    expiresIn: '15m',
    issuer: 'p2p-learning-app',
    audience: 'p2p-learning-clients',
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

/**
 * Generate a long-lived refresh token (7 days).
 * Each token is uniquely identified by a UUID (jti) to enable
 * fine-grained revocation and rotation.
 *
 * @param userId - The user's database ID
 * @returns An object containing the signed JWT string and its jti
 */
export function generateRefreshToken(userId: string): { token: string; jti: string } {
  const jti = uuidv4();
  const claims: RefreshTokenPayload = { sub: userId, jti, type: 'refresh' };
  const options: SignOptions = {
    expiresIn: '7d',
    issuer: 'p2p-learning-app',
    audience: 'p2p-learning-clients',
  };
  const token = jwt.sign(claims, env.JWT_REFRESH_SECRET, options);
  return { token, jti };
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify and decode an access token.
 *
 * @param token - Raw JWT string from the Authorization header
 * @returns Decoded {@link AccessTokenPayload}
 * @throws {JsonWebTokenError} If the token is malformed or signature is invalid
 * @throws {TokenExpiredError} If the token has expired
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'p2p-learning-app',
    audience: 'p2p-learning-clients',
  }) as AccessTokenPayload;

  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Token type mismatch: expected access token');
  }

  return payload;
}

/**
 * Verify and decode a refresh token.
 *
 * @param token - Raw JWT string from the httpOnly cookie or request body
 * @returns Decoded {@link RefreshTokenPayload}
 * @throws {JsonWebTokenError} If the token is malformed or signature is invalid
 * @throws {TokenExpiredError} If the token has expired
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: 'p2p-learning-app',
    audience: 'p2p-learning-clients',
  }) as RefreshTokenPayload;

  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Token type mismatch: expected refresh token');
  }

  return payload;
}
