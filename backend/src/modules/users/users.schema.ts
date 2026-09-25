import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@/middleware/errorHandler';

// ─── Shared field validators ──────────────────────────────────────────────────

/**
 * Password must be 8–72 chars, contain at least one uppercase letter,
 * one lowercase letter, one digit, and one special character.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    'Password must contain at least one special character',
  );

// ─── Schemas ─────────────────────────────────────────────────────────────────

/**
 * Schema for updating basic profile fields.
 * All fields are optional so callers can send partial patches.
 */
export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name cannot be empty')
    .max(50, 'First name too long')
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ '-]+$/, 'First name contains invalid characters')
    .optional(),
  lastName: z
    .string()
    .min(1, 'Last name cannot be empty')
    .max(50, 'Last name too long')
    .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ '-]+$/, 'Last name contains invalid characters')
    .optional(),
  bio: z
    .string()
    .max(500, 'Bio must not exceed 500 characters')
    .optional()
    .nullable(),
  avatarUrl: z
    .string()
    .url('Avatar URL must be a valid URL')
    .max(2048, 'Avatar URL too long')
    .optional()
    .nullable(),
});

/**
 * Schema for the change-password endpoint.
 * Both passwords are validated; an extra guard prevents reuse.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

/**
 * Schema for updating a user's age tier.
 *
 * NOTE: Age-tier changes are only permitted during initial account setup
 * (i.e., when `ageTierLocked` is false on the User record). The service
 * layer enforces this business rule; the schema only validates the shape.
 */
export const updateAgeTierSchema = z.object({
  newAgeTier: z.enum(['SCHOOL', 'COLLEGE'], {
    errorMap: () => ({
      message: "newAgeTier must be 'SCHOOL' or 'COLLEGE'",
    }),
  }),
});

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateAgeTierInput = z.infer<typeof updateAgeTierSchema>;

// ─── Middleware helper ────────────────────────────────────────────────────────

/**
 * Creates an Express middleware that validates `req.body` against a Zod schema.
 * Throws a 400 ApiError with detailed field-level errors on failure.
 *
 * @param schema - A Zod object schema to validate against.
 * @returns Express middleware function.
 *
 * @example
 * router.put('/profile', requireAuth, validate(updateProfileSchema), updateProfile);
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      const message = Object.entries(details)
        .map(([field, errors]) => `${field}: ${(errors ?? []).join(', ')}`)
        .join('; ');
      return next(ApiError.badRequest(`Validation failed — ${message}`));
    }
    // Replace req.body with the parsed (type-safe) data.
    req.body = result.data;
    next();
  };
}
