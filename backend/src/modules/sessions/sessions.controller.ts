/**
 * @file sessions.controller.ts
 * @description Controller for live session scheduling, booking, and video room token authorization.
 */

import { Request, Response, NextFunction } from 'express';
import { SessionsService } from './sessions.service';
import { ApiError } from '@/middleware/errorHandler';

const sessionsService = new SessionsService();

export class SessionsController {
  /**
   * POST /api/v1/sessions
   * Tutor creates a live session.
   */
  async createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const session = await sessionsService.createSession(req.user.id, req.body, req);
      res.status(201).json({
        success: true,
        message: 'Live session scheduled successfully',
        data: { session },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/sessions
   * Lists available upcoming sessions within user's age tier.
   */
  async listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;

      const result = await sessionsService.listAvailableSessions(req.user.ageTier, page, pageSize);
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/sessions/:sessionId/book
   * Learner books a session (strictly age-tier checked).
   */
  async bookSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { sessionId } = req.params;
      const { paymentId } = req.body;

      const booking = await sessionsService.bookSession(req.user.id, sessionId, paymentId, req);
      res.status(200).json({
        success: true,
        message: 'Session booking confirmed',
        data: { booking },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/sessions/:sessionId/room-token
   * Contract for Person 2 (Video Lead) & Person 3 (Call UI):
   * Validates participant permissions and age-tier before granting room entry credentials.
   */
  async getRoomCredentials(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { sessionId } = req.params;

      const credentials = await sessionsService.authorizeRoomAccess(req.user.id, sessionId, req);
      res.status(200).json({
        success: true,
        data: credentials,
      });
    } catch (err) {
      next(err);
    }
  }
}
