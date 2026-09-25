/**
 * @file rateLimiter.ts
 * @description In-memory and Redis-compatible rate limiters for protecting sensitive endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { ApiError } from '@/middleware/errorHandler';

// 1. Auth limiter: 10 requests per minute per IP
const authLimiterInstance = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 60 * 5, // block for 5 minutes if exceeded
});

// 2. Sensitive limiter (payouts, password reset, kyc): 5 requests per 15 minutes
const sensitiveLimiterInstance = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60,
  blockDuration: 60 * 30, // block for 30 minutes if exceeded
});

// 3. General API limiter: 120 requests per minute
const generalLimiterInstance = new RateLimiterMemory({
  points: 120,
  duration: 60,
});

/** Helper to wrap RateLimiterMemory into an Express middleware */
function createMiddleware(limiter: RateLimiterMemory, message = 'Too many requests. Please try again later.') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // In test environment, bypass rate limits to keep test suites fast and reliable
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    try {
      const clientKey = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown-ip';
      await limiter.consume(clientKey);
      next();
    } catch {
      next(ApiError.tooManyRequests(message));
    }
  };
}

export const authLimiter = createMiddleware(
  authLimiterInstance,
  'Too many authentication attempts. Please try again in 5 minutes.',
);

export const sensitiveLimiter = createMiddleware(
  sensitiveLimiterInstance,
  'Too many sensitive operations requested. Please wait before retrying.',
);

export const generalLimiter = createMiddleware(
  generalLimiterInstance,
  'Rate limit exceeded. Please slow down your requests.',
);
