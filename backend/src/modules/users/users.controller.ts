/**
 * @file users.controller.ts
 * @description Controller for user profile and account management.
 */

import { Request, Response, NextFunction } from 'express';
import { UserService, TutorSearchFilters } from '@/modules/users/users.service';
import { ApiError } from '@/middleware/errorHandler';
import { AgeTier, AccountStatus } from '@prisma/client';

const userService = new UserService();

export class UsersController {
  /**
   * GET /api/v1/users/me/profile
   */
  async getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const profile = await userService.getUserProfile(req.user.id);
      res.status(200).json({ success: true, data: profile });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/users/me/profile
   */
  async updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const updated = await userService.updateProfile(req.user.id, req.body, req);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/users/me/password
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { currentPassword, newPassword } = req.body;
      await userService.changePassword(req.user.id, currentPassword, newPassword, req);
      res.status(200).json({
        success: true,
        message: 'Password changed successfully. Please log in again on all devices.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/users/me
   */
  async deleteMyAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      await userService.deleteAccount(req.user.id, req);
      res.status(200).json({
        success: true,
        message: 'Account successfully deactivated.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/users/tutors/search
   * Authoritatively searches tutors within the requesting user's age tier.
   */
  async searchTutors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());

      const ageTier = req.user.ageTier as AgeTier;

      const filters: TutorSearchFilters = {
        subject: req.query.subject as string | undefined,
        minRating: req.query.minRating ? parseFloat(req.query.minRating as string) : undefined,
        maxHourlyRate: req.query.maxHourlyRate ? parseFloat(req.query.maxHourlyRate as string) : undefined,
        minHourlyRate: req.query.minHourlyRate ? parseFloat(req.query.minHourlyRate as string) : undefined,
        yearsExperience: req.query.yearsExperience ? parseInt(req.query.yearsExperience as string, 10) : undefined,
        isVerified: req.query.isVerified === 'true' ? true : req.query.isVerified === 'false' ? false : undefined,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
        pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20,
      };

      const result = await userService.searchTutors(ageTier, filters);
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/users/:userId/profile
   */
  async getPublicProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      if (!userId) return next(ApiError.badRequest('userId parameter is required'));
      const profile = await userService.getPublicProfile(userId);
      res.status(200).json({ success: true, data: profile });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/users/:userId/status
   */
  async updateAccountStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { userId } = req.params;
      const { status } = req.body as { status: AccountStatus };

      await userService.updateAccountStatus(userId, status, req.user.id, req);
      res.status(200).json({ success: true, message: `User status updated to ${status}` });
    } catch (err) {
      next(err);
    }
  }
}
