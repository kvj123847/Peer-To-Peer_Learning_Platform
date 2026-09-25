/**
 * @file auth.routes.ts
 * @description Authentication route declarations with rate-limiting, schema validation, and authorization guards.
 */

import { Router } from 'express';
import { AuthController } from './auth.controller';
import {
  validate,
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleOAuthSchema,
  appleOAuthSchema,
  refreshTokenSchema,
} from './auth.schema';
import { authLimiter, sensitiveLimiter } from '@/middleware/rateLimiter';
import { requireAuth } from '@/middleware/auth';

const router = Router();
const controller = new AuthController();

// Local Auth
router.post('/signup', authLimiter, validate(signupSchema), controller.signup.bind(controller));
router.post('/login', authLimiter, validate(loginSchema), controller.login.bind(controller));
router.post('/logout', requireAuth, controller.logout.bind(controller));
router.post('/refresh', validate(refreshTokenSchema), controller.refresh.bind(controller));

// OAuth
router.post('/google', authLimiter, validate(googleOAuthSchema), controller.googleOAuth.bind(controller));
router.post('/apple', authLimiter, validate(appleOAuthSchema), controller.appleOAuth.bind(controller));

// Password Reset & Verification
router.post('/forgot-password', sensitiveLimiter, validate(forgotPasswordSchema), controller.forgotPassword.bind(controller));
router.post('/reset-password', sensitiveLimiter, validate(resetPasswordSchema), controller.resetPassword.bind(controller));
router.get('/verify-email', controller.verifyEmail.bind(controller));

// Profile verification
router.get('/me', requireAuth, controller.me.bind(controller));

export default router;
