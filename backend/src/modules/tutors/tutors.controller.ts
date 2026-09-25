/**
 * @file tutors.controller.ts
 * @description Controller for tutor operations, availability, and payout onboarding.
 */

import { Request, Response, NextFunction } from 'express';
import { TutorsService } from './tutors.service';
import { ApiError } from '@/middleware/errorHandler';

const tutorsService = new TutorsService();

export class TutorsController {
  /**
   * POST /api/v1/tutors/profile
   */
  async createProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const profile = await tutorsService.createProfile(req.user.id, req.body, req);
      res.status(201).json({
        success: true,
        message: 'Tutor profile created successfully',
        data: { profile },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/tutors/profile
   */
  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const profile = await tutorsService.updateProfile(req.user.id, req.body, req);
      res.status(200).json({
        success: true,
        message: 'Tutor profile updated successfully',
        data: { profile },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/tutors/:tutorId
   * Verified by ageTierCheck middleware and verified internally by service.
   */
  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const profile = await tutorsService.getProfile(req.params.tutorId, req.user.ageTier);
      res.status(200).json({
        success: true,
        data: { profile },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/tutors/:tutorId/availability
   */
  async getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const availability = await tutorsService.getAvailability(req.params.tutorId, req.user.ageTier);
      res.status(200).json({
        success: true,
        data: availability,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/tutors/stripe-onboarding
   */
  async initiateStripeOnboarding(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { returnUrl, refreshUrl } = req.body;
      const result = await tutorsService.initiateStripeConnectOnboarding(
        req.user.id,
        returnUrl,
        refreshUrl,
        req,
      );
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
