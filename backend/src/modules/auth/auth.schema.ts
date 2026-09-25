/**
 * @file auth.schema.ts
 * @description Zod request validation schemas and validator middleware for authentication endpoints.
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@/middleware/errorHandler';

export const signupSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address format').toLowerCase().trim(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    ageTier: z.enum(['SCHOOL', 'COLLEGE'], {
      errorMap: () => ({ message: 'ageTier must be either SCHOOL or COLLEGE' }),
    }),
    role: z.enum(['LEARNER', 'TUTOR', 'BOTH'], {
      errorMap: () => ({ message: 'role must be LEARNER, TUTOR, or BOTH' }),
    }),
    firstName: z.string().min(1, 'First name is required').max(50),
    lastName: z.string().min(1, 'Last name is required').max(50),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format').toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format').toLowerCase().trim(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  }),
});

export const googleOAuthSchema = z.object({
  body: z.object({
    idToken: z.string().min(1, 'Google ID token is required'),
    ageTier: z.enum(['SCHOOL', 'COLLEGE']),
    role: z.enum(['LEARNER', 'TUTOR', 'BOTH']).default('LEARNER'),
  }),
});

export const appleOAuthSchema = z.object({
  body: z.object({
    identityToken: z.string().min(1, 'Apple identity token is required'),
    authorizationCode: z.string().optional(),
    ageTier: z.enum(['SCHOOL', 'COLLEGE']),
    role: z.enum(['LEARNER', 'TUTOR', 'BOTH']).default('LEARNER'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});

/** Generic reusable Zod validation middleware */
export function validate(schema: z.ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const formattedErrors = result.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      next(new ApiError(400, `Validation failed: ${formattedErrors.map((e) => e.message).join('; ')}`));
      return;
    }

    // Attach validated values to request
    req.body = (result.data as { body: unknown }).body;
    next();
  };
}
