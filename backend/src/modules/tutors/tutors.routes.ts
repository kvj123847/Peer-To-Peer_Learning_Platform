/**
 * @file tutors.routes.ts
 * @description Routes for tutor profile management, viewing, and payment onboarding.
 */

import { Router } from 'express';
import { TutorsController } from './tutors.controller';
import { requireAuth } from '@/middleware/auth';
import { requireRole } from '@/middleware/authorize';
import { ageTierCheck } from '@/middleware/ageTier';
import { validate } from '@/modules/auth/auth.schema';
import { createTutorProfileSchema, updateTutorProfileSchema } from './tutors.schema';
import { UserRoleType } from '@prisma/client';

const router = Router();
const controller = new TutorsController();

router.use(requireAuth);

// Tutor profile self-management (TUTOR role required)
router.post(
  '/profile',
  requireRole(UserRoleType.TUTOR),
  validate(createTutorProfileSchema),
  controller.createProfile.bind(controller),
);

router.put(
  '/profile',
  requireRole(UserRoleType.TUTOR),
  validate(updateTutorProfileSchema),
  controller.updateProfile.bind(controller),
);

router.post(
  '/stripe-onboarding',
  requireRole(UserRoleType.TUTOR),
  controller.initiateStripeOnboarding.bind(controller),
);

// Tutor profile viewing by ID (SAFETY: ageTierCheck enforces same-tier access)
router.get(
  '/:tutorId',
  ageTierCheck('tutor', 'tutorId'),
  controller.getProfile.bind(controller),
);

router.get(
  '/:tutorId/availability',
  ageTierCheck('tutor', 'tutorId'),
  controller.getAvailability.bind(controller),
);

export default router;
