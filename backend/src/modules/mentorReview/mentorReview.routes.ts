/**
 * @file mentorReview.routes.ts
 * @description Routes for mentor review workflows, approval/rejection queues, and tutor submissions.
 */

import { Router } from 'express';
import { MentorReviewController } from './mentorReview.controller';
import { requireAuth } from '@/middleware/auth';
import { requireRole } from '@/middleware/authorize';
import { UserRoleType } from '@prisma/client';
import { z } from 'zod';
import { validate } from '@/modules/auth/auth.schema';

const submitReviewSchema = z.object({
  body: z.object({
    contentId: z.string().uuid(),
    contentType: z.enum(['COURSE', 'SESSION']),
  }),
});

const rejectReviewSchema = z.object({
  body: z.object({
    feedback: z.string().min(10, 'Feedback must be at least 10 characters explaining rejection reason'),
  }),
});

const approveReviewSchema = z.object({
  body: z.object({
    feedback: z.string().optional(),
  }),
});

const router = Router();
const controller = new MentorReviewController();

router.use(requireAuth);

// Tutor actions (TUTOR role required)
router.post(
  '/submit',
  requireRole(UserRoleType.TUTOR),
  validate(submitReviewSchema),
  controller.submitForReview.bind(controller),
);

router.get(
  '/my-submissions',
  requireRole(UserRoleType.TUTOR),
  controller.getMySubmissions.bind(controller),
);

router.post(
  '/:contentType/:contentId/publish',
  requireRole(UserRoleType.TUTOR),
  controller.publishContent.bind(controller),
);

// Mentor actions (MENTOR role required)
router.get(
  '/queue',
  requireRole(UserRoleType.MENTOR),
  controller.getReviewQueue.bind(controller),
);

router.patch(
  '/:reviewId/approve',
  requireRole(UserRoleType.MENTOR),
  validate(approveReviewSchema),
  controller.approveReview.bind(controller),
);

router.patch(
  '/:reviewId/reject',
  requireRole(UserRoleType.MENTOR),
  validate(rejectReviewSchema),
  controller.rejectReview.bind(controller),
);

// Audit history
router.get('/history/:contentId', controller.getReviewHistory.bind(controller));

export default router;
