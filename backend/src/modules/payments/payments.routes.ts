/**
 * @file payments.routes.ts
 * @description Routes for checkout initiation, webhooks, transaction logs, and tutor payouts.
 */

import express, { Router } from 'express';
import { PaymentsController } from './payments.controller';
import { requireAuth } from '@/middleware/auth';
import { requireRole } from '@/middleware/authorize';
import { sensitiveLimiter } from '@/middleware/rateLimiter';
import { UserRoleType } from '@prisma/client';
import { z } from 'zod';
import { validate } from '@/modules/auth/auth.schema';

const checkoutSchema = z.object({
  body: z.object({
    itemType: z.enum(['COURSE', 'SESSION', 'CHAT']),
    itemId: z.string().uuid('Invalid item UUID'),
  }),
});

const payoutSchema = z.object({
  body: z.object({
    amount: z.number().positive('Payout amount must be greater than 0'),
    currency: z.string().default('USD'),
  }),
});

const router = Router();
const controller = new PaymentsController();

// ── Webhooks (Must receive raw Buffer, no JWT auth) ─────────────────────────
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  controller.handleWebhook.bind(controller),
);

router.post(
  '/connect-webhook',
  express.raw({ type: 'application/json' }),
  controller.handleConnectWebhook.bind(controller),
);

// ── Authenticated endpoints ─────────────────────────────────────────────────
router.post(
  '/checkout',
  requireAuth,
  validate(checkoutSchema),
  controller.createCheckout.bind(controller),
);

router.get(
  '/transactions',
  requireAuth,
  controller.getTransactions.bind(controller),
);

// ── Tutor-only endpoints ────────────────────────────────────────────────────
router.get(
  '/earnings',
  requireAuth,
  requireRole(UserRoleType.TUTOR),
  controller.getEarnings.bind(controller),
);

router.post(
  '/payout',
  requireAuth,
  requireRole(UserRoleType.TUTOR),
  sensitiveLimiter,
  validate(payoutSchema),
  controller.requestPayout.bind(controller),
);

export default router;
