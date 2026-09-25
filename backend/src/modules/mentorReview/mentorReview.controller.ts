/**
 * @file mentorReview.controller.ts
 * @description Controller for mentor review queue, approvals, rejections, and tutor submissions.
 */

import { Request, Response, NextFunction } from 'express';
import { MentorReviewService } from './mentorReview.service';
import { ApiError } from '@/middleware/errorHandler';

const mentorReviewService = new MentorReviewService();

export class MentorReviewController {
  /**
   * POST /api/v1/mentor/reviews/submit
   */
  async submitForReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { contentId, contentType } = req.body;
      const review = await mentorReviewService.submitForReview(
        req.user.id,
        contentId,
        contentType,
        req,
      );
      res.status(201).json({
        success: true,
        message: 'Content submitted for mentor review',
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/mentor/reviews/queue
   */
  async getReviewQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;

      const result = await mentorReviewService.getReviewQueue(page, pageSize);
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/mentor/reviews/:reviewId/approve
   */
  async approveReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { reviewId } = req.params;
      const { feedback } = req.body;

      const review = await mentorReviewService.approveReview(
        reviewId,
        req.user.id,
        feedback,
        req,
      );
      res.status(200).json({
        success: true,
        message: 'Review approved. Content is now eligible for publishing.',
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/mentor/reviews/:reviewId/reject
   */
  async rejectReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { reviewId } = req.params;
      const { feedback } = req.body;

      const review = await mentorReviewService.rejectReview(
        reviewId,
        req.user.id,
        feedback,
        req,
      );
      res.status(200).json({
        success: true,
        message: 'Review rejected. Feedback sent to tutor.',
        data: { review },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/mentor/reviews/:contentType/:contentId/publish
   */
  async publishContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { contentType, contentId } = req.params as {
        contentType: 'COURSE' | 'SESSION';
        contentId: string;
      };

      await mentorReviewService.publishContent(contentId, contentType, req.user.id, req);
      res.status(200).json({
        success: true,
        message: 'Content successfully published and is now visible in the learning library.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/mentor/reviews/history/:contentId
   */
  async getReviewHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { contentId } = req.params;
      const history = await mentorReviewService.getReviewHistory(contentId);
      res.status(200).json({
        success: true,
        data: { history },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/mentor/reviews/my-submissions
   */
  async getMySubmissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const reviews = await mentorReviewService.getTutorReviews(req.user.id);
      res.status(200).json({
        success: true,
        data: { reviews },
      });
    } catch (err) {
      next(err);
    }
  }
}
