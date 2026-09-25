import { Router } from 'express';
import { UsersController } from '@/modules/users/users.controller';
import { requireAuth, requireRole } from '@/middleware/auth';
import {
  validate,
  updateProfileSchema,
  changePasswordSchema,
} from '@/modules/users/users.schema';

const router = Router();
const controller = new UsersController();

// ─── Authenticated user self-service routes ───────────────────────────────────

/**
 * GET /users/me/profile
 * Fetch the authenticated user's full profile.
 */
router.get('/me/profile', requireAuth, controller.getMyProfile.bind(controller));

/**
 * PUT /users/me/profile
 * Update name, bio, and avatar URL.
 */
router.put(
  '/me/profile',
  requireAuth,
  validate(updateProfileSchema),
  controller.updateMyProfile.bind(controller),
);

/**
 * PUT /users/me/password
 * Change password (requires current password verification).
 */
router.put(
  '/me/password',
  requireAuth,
  validate(changePasswordSchema),
  controller.changePassword.bind(controller),
);

/**
 * DELETE /users/me
 * Soft-delete the authenticated user's own account.
 */
router.delete('/me', requireAuth, controller.deleteMyAccount.bind(controller));

// ─── Tutor discovery (age-tier enforced in service) ───────────────────────────

/**
 * GET /users/tutors/search
 * Search tutors filtered to the requesting user's age tier.
 * Age-tier isolation is enforced in `UserService.searchTutors`.
 */
router.get(
  '/tutors/search',
  requireAuth,
  controller.searchTutors.bind(controller),
);

// ─── Public profile ──────────────────────────────────────────────────────────

/**
 * GET /users/:userId/profile
 * Public-safe profile view — no auth required, but PII is stripped.
 *
 * NOTE: This is intentionally placed AFTER /me/* routes to prevent
 * the literal string "me" from being matched as a `:userId`.
 */
router.get('/:userId/profile', controller.getPublicProfile.bind(controller));

// ─── Admin routes ─────────────────────────────────────────────────────────────

/**
 * PATCH /users/admin/:userId/status
 * Update account status (ACTIVE | SUSPENDED | BANNED).
 * Restricted to ADMIN role.
 */
router.patch(
  '/admin/:userId/status',
  requireAuth,
  requireRole('ADMIN'),
  controller.updateAccountStatus.bind(controller),
);

export default router;
