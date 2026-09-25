/**
 * @file ageTier.ts
 * @description SAFETY-CRITICAL Middleware for Age-Tier Segregation Enforcement.
 *
 * Enforces non-negotiable hard boundary between School (<18) and College (18+) users.
 * School ↔ School is allowed.
 * College ↔ College is allowed.
 * School ↔ College is strictly PROHIBITED at API/Data level.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { assertAgeTierCompatible } from '@/utils/ageTierGuard';
import { AgeTier } from '@prisma/client';

export type ResourceType = 'tutor' | 'session' | 'course' | 'booking';

/**
 * Middleware factory that authoritatively resolves the target resource's age-tier
 * and ensures the requesting user's age-tier matches before allowing the request to proceed.
 *
 * @param resourceType - Type of resource being queried
 * @param idParam - URL route parameter name containing the resource ID
 */
export function ageTierCheck(
  resourceType: ResourceType,
  idParam?: string,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw ApiError.unauthorized('Authentication required');
      }

      const userTier = req.user.ageTier;
      const paramName = idParam ?? `${resourceType}Id`;
      const resourceId = req.params[paramName] || req.body[paramName];

      if (!resourceId) {
        throw ApiError.badRequest(`Missing identifier parameter '${paramName}' for age-tier verification.`);
      }

      let targetTier: AgeTier | null = null;

      switch (resourceType) {
        case 'tutor': {
          // Check tutor's user ageTier
          const tutor = await prisma.tutorProfile.findUnique({
            where: { id: resourceId },
            include: { user: { select: { ageTier: true } } },
          });

          if (!tutor) {
            throw ApiError.notFound('Tutor not found');
          }
          targetTier = tutor.user.ageTier;
          break;
        }

        case 'session': {
          // Check session ageTierFilter
          const session = await prisma.liveSession.findUnique({
            where: { id: resourceId },
            select: { ageTierFilter: true },
          });

          if (!session) {
            throw ApiError.notFound('Live session not found');
          }
          targetTier = session.ageTierFilter;
          break;
        }

        case 'course': {
          // Check course ageTierFilter
          const course = await prisma.course.findUnique({
            where: { id: resourceId },
            select: { ageTierFilter: true },
          });

          if (!course) {
            throw ApiError.notFound('Course not found');
          }
          targetTier = course.ageTierFilter;
          break;
        }

        case 'booking': {
          // Look up session associated with booking
          const booking = await prisma.sessionBooking.findUnique({
            where: { id: resourceId },
            include: {
              session: { select: { ageTierFilter: true } },
            },
          });

          if (!booking) {
            throw ApiError.notFound('Session booking not found');
          }
          targetTier = booking.session.ageTierFilter;
          break;
        }

        default:
          throw ApiError.internal(`Unsupported resource type for age-tier check: ${resourceType}`);
      }

      // Authoritative assert: throws AgeTierViolationError (403) if mismatched
      assertAgeTierCompatible(userTier, targetTier, resourceType);

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware: Validates that a user cannot query tutors, sessions, or courses
 * by overriding ageTier query parameter. If provided in query, it is forced to req.user.ageTier.
 */
export function enforceUserAgeTierQuery(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    req.query.ageTier = req.user.ageTier;
  }
  next();
}
