/**
 * @file express.d.ts
 * @description Augments the Express `Request` interface with application-specific
 * properties set by authentication middleware.
 *
 * These additions are available on `req` in every route handler and middleware
 * after the JWT auth middleware runs.
 */

import type { AgeTier, AccountStatus } from '@prisma/client';

export {};

declare global {
  namespace Express {
    /**
     * Extended Express Request interface.
     */
    interface Request {
      /**
       * Authenticated user payload decoded from the JWT access token.
       * Populated by the `authenticate` middleware.
       * `undefined` on unauthenticated routes.
       */
      user?: {
        /** UUID of the authenticated user. */
        id: string;
        /** Verified email address of the authenticated user. */
        email: string;
        /** Age-based content tier the user belongs to. */
        ageTier: AgeTier;
        /** Current lifecycle state of the account. */
        accountStatus: AccountStatus;
        /** List of active role names the user currently holds (e.g. ['TUTOR', 'LEARNER']). */
        roles: string[];
      };

      /**
       * Unique identifier for this HTTP request, set by the requestId middleware.
       * Included in all log entries for end-to-end request tracing.
       */
      requestId?: string;
    }
  }
}
