/**
 * @file sessions.routes.ts
 * @description Routes for live sessions, bookings, and video room token authorization.
 */

import { Router } from 'express';
import { SessionsController } from './sessions.controller';
import { requireAuth } from '@/middleware/auth';
import { requireRole } from '@/middleware/authorize';
import { ageTierCheck } from '@/middleware/ageTier';
import { UserRoleType } from '@prisma/client';
import { z } from 'zod';
import { validate } from '@/modules/auth/auth.schema';

const createSessionSchema = z.object({
  body: z.object({
    title: z.string().min(5).max(150),
    description: z.string().min(10).max(2000),
    sessionType: z.enum(['ONE_ON_ONE', 'GROUP']),
    subject: z.string().min(2),
    maxParticipants: z.number().int().positive().optional(),
    price: z.number().nonnegative(),
    currency: z.string().default('USD'),
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(180),
  }),
});

const router = Router();
const controller = new SessionsController();

router.use(requireAuth);

// Tutor creates session (TUTOR role required)
router.post(
  '/',
  requireRole(UserRoleType.TUTOR),
  validate(createSessionSchema),
  controller.createSession.bind(controller),
);

// List upcoming sessions (age-tier filtered to requesting user)
router.get('/', controller.listSessions.bind(controller));

// Learner books a session (ageTierCheck verifies matching tier)
router.post(
  '/:sessionId/book',
  ageTierCheck('session', 'sessionId'),
  controller.bookSession.bind(controller),
);

// Video Room access credentials (contract for Person 2 & 3: age-tier verified)
router.get(
  '/:sessionId/room-token',
  ageTierCheck('session', 'sessionId'),
  controller.getRoomCredentials.bind(controller),
);

export default router;
