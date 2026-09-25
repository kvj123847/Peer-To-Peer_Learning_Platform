/**
 * @file payments.service.ts
 * @description Production payments service using Stripe and Stripe Connect.
 * Enforces age-tier safety gating before checkout, calculates platform fee split,
 * maintains tutor balance ledger, handles KYC verification, and manages transfers.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { assertAgeTierCompatible } from '@/utils/ageTierGuard';
import { auditLog } from '@/utils/audit';
import { sendPayoutNotification, sendBookingConfirmation } from '@/utils/email';
import Stripe from 'stripe';
import { env } from '@/config/env';
import {
  AgeTier,
  PaymentType,
  PaymentStatus,
  EarningStatus,
  PayoutStatus,
  Prisma,
  BookingStatus,
} from '@prisma/client';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20' as unknown as Stripe.LatestApiVersion,
});

const PLATFORM_FEE_RATE = 0.20; // 20% platform fee

export interface CheckoutResultDto {
  paymentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
}

export interface TutorEarningsSummaryDto {
  availableBalance: number;
  pendingBalance: number;
  totalEarned: number;
  currency: string;
  earnings: {
    id: string;
    grossAmount: number;
    platformFee: number;
    netAmount: number;
    currency: string;
    status: EarningStatus;
    createdAt: Date;
  }[];
}

export class PaymentsService {
  /**
   * Creates a Stripe checkout intent for course purchase or live session booking.
   * SAFETY-CRITICAL: Validates age-tier compatibility before permitting checkout creation.
   */
  async createCheckoutSession(
    learnerUserId: string,
    itemType: 'COURSE' | 'SESSION' | 'CHAT',
    itemId: string,
    req?: Request,
  ): Promise<CheckoutResultDto> {
    const learner = await prisma.user.findUnique({
      where: { id: learnerUserId },
    });

    if (!learner) {
      throw ApiError.notFound('Learner not found');
    }

    let price: number;
    let currency: string;
    let tutorId: string;
    let targetAgeTier: AgeTier;
    let description: string;

    if (itemType === 'COURSE') {
      const course = await prisma.course.findUnique({
        where: { id: itemId },
        include: { tutor: true },
      });

      if (!course) throw ApiError.notFound('Course not found');
      targetAgeTier = course.ageTierFilter;
      price = Number(course.price);
      currency = course.currency.toLowerCase();
      tutorId = course.tutorId;
      description = `Course Purchase: ${course.title}`;
    } else if (itemType === 'SESSION') {
      const session = await prisma.liveSession.findUnique({
        where: { id: itemId },
        include: { tutor: true },
      });

      if (!session) throw ApiError.notFound('Live session not found');
      targetAgeTier = session.ageTierFilter;
      price = Number(session.price);
      currency = session.currency.toLowerCase();
      tutorId = session.tutorId;
      description = `Live Session: ${session.title}`;
    } else {
      // Chat session doubt clearing
      const tutor = await prisma.tutorProfile.findUnique({
        where: { id: itemId },
        include: { user: true },
      });

      if (!tutor) throw ApiError.notFound('Tutor not found');
      targetAgeTier = tutor.user.ageTier;
      price = Number(tutor.hourlyRate) * 0.5; // half-hour chat doubt rate
      currency = tutor.currency.toLowerCase();
      tutorId = tutor.id;
      description = `Chat Doubt Session with Tutor`;
    }

    // SAFETY-CRITICAL: Prohibit cross-tier purchases
    assertAgeTierCompatible(
      learner.ageTier,
      targetAgeTier,
      `checkout for ${itemType.toLowerCase()}`,
    );

    // Map internal type to Prisma PaymentType enum
    const paymentType =
      itemType === 'COURSE'
        ? PaymentType.COURSE_PURCHASE
        : itemType === 'SESSION'
          ? PaymentType.SESSION_BOOKING
          : PaymentType.CHAT_SESSION;

    // Create DB Payment record in PENDING status
    const payment = await prisma.payment.create({
      data: {
        userId: learnerUserId,
        amount: new Prisma.Decimal(price),
        currency: currency.toUpperCase(),
        type: paymentType,
        status: PaymentStatus.PENDING,
        metadata: {
          itemType,
          itemId,
          tutorId,
          learnerAgeTier: learner.ageTier,
        },
      },
    });

    let clientSecret = `pi_mock_${payment.id}_secret_test`;

    // Create real Stripe PaymentIntent if not in test mock
    if (process.env.NODE_ENV !== 'test' || !env.STRIPE_SECRET_KEY.includes('placeholder')) {
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(price * 100), // convert to smallest currency unit (cents)
          currency,
          description,
          metadata: {
            paymentId: payment.id,
            learnerUserId,
            tutorId,
            itemType,
            itemId,
          },
        });

        clientSecret = paymentIntent.client_secret || clientSecret;

        await prisma.payment.update({
          where: { id: payment.id },
          data: { stripePaymentIntentId: paymentIntent.id },
        });
      } catch (err: any) {
        throw ApiError.badRequest(`Payment initialization failed: ${err.message}`);
      }
    }

    await auditLog({
      actorId: learnerUserId,
      action: 'PAYMENT_CHECKOUT_INITIATED',
      resource: 'Payment',
      resourceId: payment.id,
      metadata: { itemType, itemId, amount: price },
      success: true,
      req,
    });

    return {
      paymentId: payment.id,
      clientSecret,
      amount: price,
      currency: currency.toUpperCase(),
    };
  }

  /**
   * Webhook handler for primary Stripe payments.
   */
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err: any) {
      throw ApiError.badRequest(`Webhook Signature Verification Failed: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata.paymentId;

      if (paymentId) {
        await this.fulfillPayment(paymentId, intent.id);
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata.paymentId;

      if (paymentId) {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.FAILED },
        });
      }
    }
  }

  /**
   * Completes payment, creates tutor earnings breakdown, and issues bookings.
   */
  async fulfillPayment(paymentId: string, stripePaymentIntentId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: true },
    });

    if (!payment || payment.status === PaymentStatus.SUCCEEDED) {
      return;
    }

    const metadata = (payment.metadata ?? {}) as Record<string, any>;
    const tutorId = metadata.tutorId as string;
    const itemId = metadata.itemId as string;
    const itemType = metadata.itemType as string;

    const gross = Number(payment.amount);
    const platformFee = Math.round(gross * PLATFORM_FEE_RATE * 100) / 100;
    const net = Math.round((gross - platformFee) * 100) / 100;

    await prisma.$transaction(async (tx) => {
      // 1. Mark payment as SUCCEEDED
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripePaymentIntentId,
        },
      });

      // 2. Create TutorEarning ledger record
      if (tutorId) {
        await tx.tutorEarning.create({
          data: {
            tutorId,
            paymentId,
            grossAmount: new Prisma.Decimal(gross),
            platformFee: new Prisma.Decimal(platformFee),
            netAmount: new Prisma.Decimal(net),
            currency: payment.currency,
            status: EarningStatus.AVAILABLE,
          },
        });

        // 3. Increment tutor total earnings counter
        await tx.tutorProfile.update({
          where: { id: tutorId },
          data: {
            totalEarnings: {
              increment: new Prisma.Decimal(net),
            },
          },
        });
      }

      // 4. Create confirmed session booking if this was a session purchase
      if (itemType === 'SESSION' && itemId) {
        await tx.sessionBooking.create({
          data: {
            sessionId: itemId,
            learnerId: payment.userId,
            status: BookingStatus.CONFIRMED,
            paymentId,
          },
        });
      }
    });

    // Send confirmation email
    if (payment.user.email) {
      sendBookingConfirmation(
        payment.user.email,
        itemType === 'SESSION' ? 'Live Session Booking' : 'Course Access',
        new Date(),
      ).catch(() => {});
    }

    await auditLog({
      actorId: payment.userId,
      action: 'PAYMENT_FULFILLED',
      resource: 'Payment',
      resourceId: paymentId,
      metadata: { gross, net, platformFee, tutorId },
      success: true,
    });
  }

  /**
   * Handles Stripe Connect account updates (KYC status and charge/payout capabilities).
   */
  async handleStripeConnectWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_CONNECT_WEBHOOK_SECRET,
      );
    } catch (err: any) {
      throw ApiError.badRequest(`Connect Webhook Signature Verification Failed: ${err.message}`);
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      const stripeAccountId = account.id;

      const tutor = await prisma.tutorProfile.findFirst({
        where: { stripeAccountId },
      });

      if (tutor) {
        const chargesEnabled = account.charges_enabled;
        const payoutsEnabled = account.payouts_enabled;

        const kycStatus = payoutsEnabled
          ? 'VERIFIED'
          : account.requirements?.currently_due && account.requirements.currently_due.length > 0
            ? 'PENDING'
            : 'VERIFIED';

        await prisma.tutorProfile.update({
          where: { id: tutor.id },
          data: {
            stripeAccountStatus: chargesEnabled && payoutsEnabled ? 'ACTIVE' : 'PENDING',
            kycStatus,
          },
        });
      }
    }
  }

  /**
   * Requests a payout transfer to the tutor's bank account via Stripe Connect.
   * Validates KYC, age tier (guardian approval for minors), and available balance.
   */
  async requestPayout(
    userId: string,
    amount: number,
    currency = 'USD',
    req?: Request,
  ): Promise<{ payoutId: string; amount: number; status: string }> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor profile not found');
    }

    // KYC Check
    if (tutor.kycStatus !== 'VERIFIED' || tutor.stripeAccountStatus !== 'ACTIVE') {
      throw ApiError.forbidden(
        'Payouts require complete and verified KYC on your connected Stripe account.',
      );
    }

    // Safety & Compliance: School tier tutor (minor) guardian verification check
    if (tutor.user.ageTier === AgeTier.SCHOOL) {
      // Ensure guardian compliance flag / approval exists
      const metadata = (tutor.availability ?? {}) as Record<string, any>;
      if (!metadata.guardianApprovedPayout) {
        throw ApiError.forbidden(
          'School-tier tutors under 18 require an active guardian-linked account for real-money payouts.',
        );
      }
    }

    // Calculate available balance from ledger
    const availableEarnings = await prisma.tutorEarning.findMany({
      where: {
        tutorId: tutor.id,
        status: EarningStatus.AVAILABLE,
      },
    });

    const currentBalance = availableEarnings.reduce(
      (sum, e) => sum + Number(e.netAmount),
      0,
    );

    if (amount <= 0 || amount > currentBalance) {
      throw ApiError.badRequest(
        `Insufficient available balance. Requested: ${amount}, Available: ${currentBalance.toFixed(2)}`,
      );
    }

    // Create Payout record
    const payout = await prisma.payout.create({
      data: {
        tutorId: tutor.id,
        amount: new Prisma.Decimal(amount),
        currency: currency.toUpperCase(),
        status: PayoutStatus.PENDING,
        initiatedAt: new Date(),
      },
    });

    // Execute Stripe transfer to connected account
    let stripeTransferId: string | null = null;
    if (tutor.stripeAccountId && !tutor.stripeAccountId.startsWith('test_')) {
      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(amount * 100),
          currency: currency.toLowerCase(),
          destination: tutor.stripeAccountId,
          description: `Tutor Payout #${payout.id}`,
        });
        stripeTransferId = transfer.id;
      } catch (err: any) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: PayoutStatus.FAILED,
            failureReason: err.message,
          },
        });
        throw ApiError.badRequest(`Transfer failed: ${err.message}`);
      }
    }

    // Update payout and mark earnings as PAID_OUT
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.PAID,
          stripePayoutId: stripeTransferId,
          completedAt: new Date(),
        },
      });

      // Mark matching earnings up to amount as PAID_OUT
      let remainingToMark = amount;
      for (const earning of availableEarnings) {
        if (remainingToMark <= 0) break;
        const net = Number(earning.netAmount);

        await tx.tutorEarning.update({
          where: { id: earning.id },
          data: { status: EarningStatus.PAID_OUT, paidOutAt: new Date() },
        });

        remainingToMark -= net;
      }
    });

    if (tutor.user.email) {
      sendPayoutNotification(tutor.user.email, amount, currency).catch(() => {});
    }

    await auditLog({
      actorId: userId,
      action: 'TUTOR_PAYOUT_DISPATCHED',
      resource: 'Payout',
      resourceId: payout.id,
      metadata: { amount, currency, stripeTransferId },
      success: true,
      req,
    });

    return {
      payoutId: payout.id,
      amount,
      status: 'PAID',
    };
  }

  /**
   * Retrieves tutor earnings summary and ledger history.
   */
  async getTutorEarnings(userId: string): Promise<TutorEarningsSummaryDto> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor profile not found');
    }

    const earnings = await prisma.tutorEarning.findMany({
      where: { tutorId: tutor.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let available = 0;
    let pending = 0;

    for (const e of earnings) {
      if (e.status === EarningStatus.AVAILABLE) available += Number(e.netAmount);
      if (e.status === EarningStatus.PENDING) pending += Number(e.netAmount);
    }

    return {
      availableBalance: Math.round(available * 100) / 100,
      pendingBalance: Math.round(pending * 100) / 100,
      totalEarned: Number(tutor.totalEarnings),
      currency: tutor.currency,
      earnings: earnings.map((e) => ({
        id: e.id,
        grossAmount: Number(e.grossAmount),
        platformFee: Number(e.platformFee),
        netAmount: Number(e.netAmount),
        currency: e.currency,
        status: e.status,
        createdAt: e.createdAt,
      })),
    };
  }

  /**
   * Retrieves transaction history for an individual learner.
   */
  async getUserTransactions(userId: string, page = 1, pageSize = 20) {
    const skip = (Math.max(1, page) - 1) * pageSize;

    const [transactions, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where: { userId } }),
    ]);

    return {
      data: transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        currency: t.currency,
        type: t.type,
        status: t.status,
        createdAt: t.createdAt,
        metadata: t.metadata,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
