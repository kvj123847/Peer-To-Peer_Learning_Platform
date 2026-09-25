/**
 * @file mentorReview.test.ts
 * @description Test suite for the Mentor Review Workflow (Person 1 Spec Section 1.5):
 * Tutor submits -> PENDING_REVIEW -> mentor receives queue item -> APPROVED or REJECTED ->
 * feedback stored -> approved item becomes publishable.
 */

import request from 'supertest';
import app from '@/app';
import { prisma } from '@/config/database';
import { generateAccessToken } from '@/utils/jwt';
import { AgeTier, AccountStatus, UserRoleType, PublishStatus } from '@prisma/client';

describe('Mentor Review Workflow', () => {
  let tutorUserId: string;
  let tutorProfileId: string;
  let tutorToken: string;

  let mentorUserId: string;
  let mentorToken: string;

  let learnerToken: string;

  let courseId: string;
  let reviewId: string;

  beforeAll(async () => {
    // 1. Create Tutor
    const tutor = await prisma.user.create({
      data: {
        email: `mentor_test_tutor_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.TUTOR, isActive: true }] },
        tutorProfile: {
          create: {
            bio: 'Test Tutor for Review Workflow',
            subjects: ['Physics'],
            hourlyRate: 30.0,
            educationLevel: 'BSc',
            isVerifiedByMentor: true,
            availability: {},
          },
        },
      },
      include: { tutorProfile: true },
    });
    tutorUserId = tutor.id;
    tutorProfileId = tutor.tutorProfile!.id;
    tutorToken = generateAccessToken({
      sub: tutor.id,
      email: tutor.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['TUTOR'],
    });

    // 2. Create Verified Mentor
    const mentor = await prisma.user.create({
      data: {
        email: `mentor_test_mentor_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.MENTOR, isActive: true }] },
        mentorProfile: {
          create: {
            degreeName: 'Ph.D. in Physics',
            university: 'Oxford',
            degreeVerificationUrl: 'https://example.com/degree.pdf',
            isVerified: true,
          },
        },
      },
    });
    mentorUserId = mentor.id;
    mentorToken = generateAccessToken({
      sub: mentor.id,
      email: mentor.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['MENTOR'],
    });

    // 3. Create Learner (Unauthorized for reviews)
    const learner = await prisma.user.create({
      data: {
        email: `mentor_test_learner_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.LEARNER, isActive: true }] },
      },
    });
    learnerToken = generateAccessToken({
      sub: learner.id,
      email: learner.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['LEARNER'],
    });

    // 4. Create Draft Course
    const course = await prisma.course.create({
      data: {
        tutorId: tutorProfileId,
        title: 'Quantum Mechanics 101',
        description: 'Comprehensive college guide to quantum states.',
        subject: 'Physics',
        ageTierFilter: AgeTier.COLLEGE,
        price: 49.99,
        currency: 'USD',
        publishStatus: PublishStatus.DRAFT,
      },
    });
    courseId = course.id;
  });

  afterAll(async () => {
    await prisma.contentReview.deleteMany({ where: { contentId: courseId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.mentorProfile.deleteMany({ where: { userId: mentorUserId } });
    await prisma.tutorProfile.deleteMany({ where: { id: tutorProfileId } });
    await prisma.userRole.deleteMany({ where: { userId: { in: [tutorUserId, mentorUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [tutorUserId, mentorUserId] } } });
    await prisma.$disconnect();
  });

  it('1. Tutor should NOT be able to publish a DRAFT course directly', async () => {
    const res = await request(app)
      .post(`/api/v1/mentor/COURSE/${courseId}/publish`)
      .set('Authorization', `Bearer ${tutorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Must be APPROVED by a mentor/i);
  });

  it('2. Tutor submits course for review -> status becomes PENDING_REVIEW', async () => {
    const res = await request(app)
      .post('/api/v1/mentor/submit')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        contentId: courseId,
        contentType: 'COURSE',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.review.status).toBe('PENDING_REVIEW');
    reviewId = res.body.data.review.id;

    // Check DB course status
    const updatedCourse = await prisma.course.findUnique({ where: { id: courseId } });
    expect(updatedCourse?.publishStatus).toBe(PublishStatus.PENDING_REVIEW);
  });

  it('3. Non-mentor (Learner) cannot view the mentor review queue (403)', async () => {
    const res = await request(app)
      .get('/api/v1/mentor/queue')
      .set('Authorization', `Bearer ${learnerToken}`);

    expect(res.status).toBe(403);
  });

  it('4. Verified Mentor views queue and sees the submitted item', async () => {
    const res = await request(app)
      .get('/api/v1/mentor/queue')
      .set('Authorization', `Bearer ${mentorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const queueIds = res.body.data.map((item: any) => item.id);
    expect(queueIds).toContain(reviewId);
  });

  it('5. Rejection must require minimum 10 characters of feedback', async () => {
    const res = await request(app)
      .patch(`/api/v1/mentor/${reviewId}/reject`)
      .set('Authorization', `Bearer ${mentorToken}`)
      .send({ feedback: 'Too short' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Feedback must be at least 10 characters/i);
  });

  it('6. Verified Mentor approves the review', async () => {
    const res = await request(app)
      .patch(`/api/v1/mentor/${reviewId}/approve`)
      .set('Authorization', `Bearer ${mentorToken}`)
      .send({ feedback: 'Outstanding course syllabus and structure.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.review.status).toBe('APPROVED');

    const updatedCourse = await prisma.course.findUnique({ where: { id: courseId } });
    expect(updatedCourse?.publishStatus).toBe(PublishStatus.APPROVED);
  });

  it('7. Tutor can now successfully publish the APPROVED course', async () => {
    const res = await request(app)
      .post(`/api/v1/mentor/COURSE/${courseId}/publish`)
      .set('Authorization', `Bearer ${tutorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const publishedCourse = await prisma.course.findUnique({ where: { id: courseId } });
    expect(publishedCourse?.publishStatus).toBe(PublishStatus.PUBLISHED);
  });
});
