/**
 * @file payments.controller.ts
 * @description Controller for checkout creation, webhooks, earnings, and tutor payouts.
 */

import { Request, Response, NextFunction } from 'express';
import { PaymentsService } from './payments.service';
import { ApiError } from '@/middleware/errorHandler';

const paymentsService = new PaymentsService();

export class PaymentsController {
  /**
   * POST /api/v1/payments/checkout
   * Initiates payment for a course, live session, or chat doubt session.
   */
  async createCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { itemType, itemId } = req.body;

      const result = await paymentsService.createCheckoutSession(
        req.user.id,
        itemType,
        itemId,
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

  /**
   * POST /api/v1/payments/webhook
   * Handles Stripe payment webhooks (raw body required).
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sig = req.headers['stripe-signature'];
      if (!sig) {
        res.status(400).send('Missing stripe-signature header');
        return;
      }

      await paymentsService.handleStripeWebhook(req.body, sig.toString());
      res.status(200).json({ received: true });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/connect-webhook
   * Handles Stripe Connect webhooks (account updates, KYC verification).
   */
  async handleConnectWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sig = req.headers['stripe-signature'];
      if (!sig) {
        res.status(400).send('Missing stripe-signature header');
        return;
      }

      await paymentsService.handleStripeConnectWebhook(req.body, sig.toString());
      res.status(200).json({ received: true });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/payments/transactions
   * Learner's purchase history.
   */
  async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;

      const result = await paymentsService.getUserTransactions(req.user.id, page, pageSize);
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/payments/earnings
   * Tutor's balance ledger and payout availability.
   */
  async getEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const earnings = await paymentsService.getTutorEarnings(req.user.id);
      res.status(200).json({
        success: true,
        data: earnings,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/payout
   * Tutor initiates payout to their connected Stripe account.
   */
  async requestPayout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) return next(ApiError.unauthorized());
      const { amount, currency } = req.body;

      const result = await paymentsService.requestPayout(
        req.user.id,
        Number(amount),
        currency,
        req,
      );

      res.status(200).json({
        success: true,
        message: 'Payout successfully processed',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
