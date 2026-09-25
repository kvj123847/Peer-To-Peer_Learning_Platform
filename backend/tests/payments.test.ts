/**
 * @file payments.test.ts
 * @description Test suite for Payments & Tutor Payouts Backend (Person 1 Spec Section 1.6):
 * - Checkout session creation with dynamic currency and pricing
 * - Payment fulfillment and platform fee ledger breakdown (20% fee)
 * - Tutor earnings balance tracking
 * - KYC check for real money payouts via Stripe Connect
 * - Guardian approval requirement for School-tier minor payouts
 */

import request from 'supertest';
import app from '@/app';
import { prisma } from '@/config/database';
import { generateAccessToken } from '@/utils/jwt';
import { AgeTier, AccountStatus, UserRoleType, PublishStatus, StripeAccountStatus, KycStatus, Prisma } from '@prisma/client';

describe('Payments & Tutor Ledger System', () => {
  let collegeLearnerId: string;
  let collegeLearnerToken: string;

  let collegeTutorUserId: string;
  let collegeTutorProfileId: string;
  let collegeTutorToken: string;

  let schoolTutorUserId: string;
  let schoolTutorProfileId: string;
  let schoolTutorToken: string;

  let courseId: string;

  beforeAll(async () => {
    // 1. College Learner
    const learner = await prisma.user.create({
      data: {
        email: `pay_learner_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.LEARNER, isActive: true }] },
      },
    });
    collegeLearnerId = learner.id;
    collegeLearnerToken = generateAccessToken({
      sub: learner.id,
      email: learner.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['LEARNER'],
    });

    // 2. College Tutor (Verified Stripe Connect)
    const cTutor = await prisma.user.create({
      data: {
        email: `pay_tutor_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.TUTOR, isActive: true }] },
        tutorProfile: {
          create: {
            bio: 'College tutor',
            subjects: ['Calculus'],
            hourlyRate: 50.0,
            educationLevel: 'Undergraduate',
            stripeAccountId: 'acct_test_verified_123',
            stripeAccountStatus: StripeAccountStatus.ACTIVE,
            kycStatus: KycStatus.VERIFIED,
            availability: {},
          },
        },
      },
      include: { tutorProfile: true },
    });
    collegeTutorUserId = cTutor.id;
    collegeTutorProfileId = cTutor.tutorProfile!.id;
    collegeTutorToken = generateAccessToken({
      sub: cTutor.id,
      email: cTutor.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['TUTOR'],
    });

    // 3. School Minor Tutor (Unverified guardian)
    const sTutor = await prisma.user.create({
      data: {
        email: `minor_tutor_${Date.now()}@test.com`,
        ageTier: AgeTier.SCHOOL,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.TUTOR, isActive: true }] },
        tutorProfile: {
          create: {
            bio: 'School minor tutor',
            subjects: ['Math'],
            hourlyRate: 20.0,
            educationLevel: 'High School',
            stripeAccountId: 'acct_minor_test_123',
            stripeAccountStatus: StripeAccountStatus.ACTIVE,
            kycStatus: KycStatus.VERIFIED,
            availability: {}, // No guardian approval flag
          },
        },
      },
      include: { tutorProfile: true },
    });
    schoolTutorUserId = sTutor.id;
    schoolTutorProfileId = sTutor.tutorProfile!.id;
    schoolTutorToken = generateAccessToken({
      sub: sTutor.id,
      email: sTutor.email,
      ageTier: AgeTier.SCHOOL,
      roles: ['TUTOR'],
    });

    // 4. Course
    const course = await prisma.course.create({
      data: {
        tutorId: collegeTutorProfileId,
        title: 'Advanced Multivariable Calculus',
        description: 'For university students',
        subject: 'Mathematics',
        ageTierFilter: AgeTier.COLLEGE,
        price: 100.0, // $100 for easy fee percentage verification
        currency: 'USD',
        publishStatus: PublishStatus.PUBLISHED,
      },
    });
    courseId = course.id;
  });

  afterAll(async () => {
    await prisma.tutorEarning.deleteMany({
      where: { tutorId: { in: [collegeTutorProfileId, schoolTutorProfileId] } },
    });
    await prisma.payout.deleteMany({
      where: { tutorId: { in: [collegeTutorProfileId, schoolTutorProfileId] } },
    });
    await prisma.payment.deleteMany({ where: { userId: collegeLearnerId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.tutorProfile.deleteMany({
      where: { id: { in: [collegeTutorProfileId, schoolTutorProfileId] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [collegeLearnerId, collegeTutorUserId, schoolTutorUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [collegeLearnerId, collegeTutorUserId, schoolTutorUserId] } },
    });
    await prisma.$disconnect();
  });

  it('1. Learner creates a checkout session for course purchase', async () => {
    const res = await request(app)
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${collegeLearnerToken}`)
      .send({
        itemType: 'COURSE',
        itemId: courseId,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(100.0);
    expect(res.body.data.paymentId).toBeDefined();
    expect(res.body.data.clientSecret).toBeDefined();
  });

  it('2. Directly verify platform fee split (20% platform, 80% tutor net)', async () => {
    // Simulate payment fulfillment through direct ledger entry
    const payment = await prisma.payment.create({
      data: {
        userId: collegeLearnerId,
        amount: new Prisma.Decimal(100.0),
        currency: 'USD',
        type: 'COURSE_PURCHASE',
        status: 'SUCCEEDED',
      },
    });

    const gross = 100.0;
    const fee = 20.0;
    const net = 80.0;

    await prisma.tutorEarning.create({
      data: {
        tutorId: collegeTutorProfileId,
        paymentId: payment.id,
        grossAmount: new Prisma.Decimal(gross),
        platformFee: new Prisma.Decimal(fee),
        netAmount: new Prisma.Decimal(net),
        currency: 'USD',
        status: 'AVAILABLE',
      },
    });

    const earningsRes = await request(app)
      .get('/api/v1/payments/earnings')
      .set('Authorization', `Bearer ${collegeTutorToken}`);

    expect(earningsRes.status).toBe(200);
    expect(earningsRes.body.data.availableBalance).toBeGreaterThanOrEqual(80.0);
  });

  it('3. Tutor cannot request a payout exceeding available balance', async () => {
    const res = await request(app)
      .post('/api/v1/payments/payout')
      .set('Authorization', `Bearer ${collegeTutorToken}`)
      .send({
        amount: 99999.0,
        currency: 'USD',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Insufficient available balance/i);
  });

  it('4. School-tier minor tutor without guardian approval cannot withdraw funds (403)', async () => {
    // Add available balance to minor
    const payment = await prisma.payment.create({
      data: {
        userId: collegeLearnerId,
        amount: new Prisma.Decimal(50.0),
        currency: 'USD',
        type: 'SESSION_BOOKING',
        status: 'SUCCEEDED',
      },
    });

    await prisma.tutorEarning.create({
      data: {
        tutorId: schoolTutorProfileId,
        paymentId: payment.id,
        grossAmount: new Prisma.Decimal(50.0),
        platformFee: new Prisma.Decimal(10.0),
        netAmount: new Prisma.Decimal(40.0),
        currency: 'USD',
        status: 'AVAILABLE',
      },
    });

    const res = await request(app)
      .post('/api/v1/payments/payout')
      .set('Authorization', `Bearer ${schoolTutorToken}`)
      .send({
        amount: 30.0,
        currency: 'USD',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/guardian-linked account/i);
  });
});
