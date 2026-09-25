/**
 * @file authorize.ts
 * @description Fine-grained authorization guards: role requirements and resource ownership checks.
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@/middleware/errorHandler';
import { UserRoleType } from '@prisma/client';

/**
 * Middleware factory: Enforce that the authenticated user possesses at least one of the specified roles.
 * Must be executed AFTER requireAuth.
 */
export function requireRole(...roles: (UserRoleType | string)[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const hasRole = roles.some((role) => req.user!.roles.includes(role));
    if (!hasRole) {
      return next(
        ApiError.forbidden(
          `Action forbidden: requires one of [${roles.join(', ')}] permissions.`,
        ),
      );
    }

    next();
  };
}

/** Convenience shorthand for Mentor-only routes */
export const requireMentor = requireRole(UserRoleType.MENTOR);

/** Convenience shorthand for Tutor-only routes */
export const requireTutor = requireRole(UserRoleType.TUTOR);

/** Convenience shorthand for Learner routes */
export const requireLearner = requireRole(UserRoleType.LEARNER);

/**
 * Middleware: Verifies that the authenticated user is accessing their own resource.
 * Compares req.params[paramName] against req.user.id.
 *
 * @param paramName - The URL parameter holding the user ID (default: 'userId')
 */
export function requireOwnership(paramName = 'userId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    const targetUserId = req.params[paramName];
    if (!targetUserId) {
      return next(ApiError.badRequest(`Missing route parameter '${paramName}'`));
    }

    if (req.user.id !== targetUserId) {
      return next(
        ApiError.forbidden('You do not have permission to access or modify this resource'),
      );
    }

    next();
  };
}
