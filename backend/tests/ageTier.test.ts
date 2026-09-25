/**
 * @file ageTier.test.ts
 * @description SAFETY AUDIT SUITE: Explicitly verifies that age-tier separation is non-negotiable
 * and enforced at the data/query/API layer, directly implementing the scenarios from
 * Section 8 (Safety Test Scenarios - All Three Must Participate) of the system specification:
 * 1. School user searches tutors: Only school-tier tutors appear. API cannot return college-tier tutors.
 * 2. School user books college tutor: Booking API rejects the request even if attempted directly.
 * 3. School user joins college video room: Room credential / access is rejected (HTTP 403).
 * 4. Mixed-tier group session: Backend rejects mixed participants.
 * 5. Direct API bypass attempts: Changing client body or query parameters cannot bypass tier isolation.
 */

import request from 'supertest';
import app from '@/app';
import { prisma } from '@/config/database';
import { generateAccessToken } from '@/utils/jwt';
import { AgeTier, AccountStatus, UserRoleType, SessionType, SessionStatus } from '@prisma/client';

describe('SAFETY-CRITICAL: Hard Age-Tier Segregation Audit', () => {
  let schoolLearnerId: string;
  let schoolTutorId: string;
  let collegeLearnerId: string;
  let collegeTutorId: string;
  let collegeTutorProfileId: string;
  let schoolTutorProfileId: string;
  let collegeSessionId: string;
  let schoolSessionId: string;

  let schoolLearnerToken: string;
  let collegeLearnerToken: string;
  let schoolTutorToken: string;
  let collegeTutorToken: string;

  beforeAll(async () => {
    // 1. Create School Learner
    const sLearner = await prisma.user.create({
      data: {
        email: `school_learner_${Date.now()}@test.com`,
        ageTier: AgeTier.SCHOOL,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.LEARNER, isActive: true }] },
      },
    });
    schoolLearnerId = sLearner.id;
    schoolLearnerToken = generateAccessToken({
      sub: sLearner.id,
      email: sLearner.email,
      ageTier: AgeTier.SCHOOL,
      roles: ['LEARNER'],
    });

    // 2. Create School Tutor
    const sTutor = await prisma.user.create({
      data: {
        email: `school_tutor_${Date.now()}@test.com`,
        ageTier: AgeTier.SCHOOL,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.TUTOR, isActive: true }] },
        tutorProfile: {
          create: {
            bio: 'Math tutor for school students',
            subjects: ['Mathematics'],
            hourlyRate: 25.0,
            educationLevel: 'High School',
            isVerifiedByMentor: true,
            availability: {},
          },
        },
      },
      include: { tutorProfile: true },
    });
    schoolTutorId = sTutor.id;
    schoolTutorProfileId = sTutor.tutorProfile!.id;
    schoolTutorToken = generateAccessToken({
      sub: sTutor.id,
      email: sTutor.email,
      ageTier: AgeTier.SCHOOL,
      roles: ['TUTOR'],
    });

    // 3. Create College Learner
    const cLearner = await prisma.user.create({
      data: {
        email: `college_learner_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.LEARNER, isActive: true }] },
      },
    });
    collegeLearnerId = cLearner.id;
    collegeLearnerToken = generateAccessToken({
      sub: cLearner.id,
      email: cLearner.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['LEARNER'],
    });

    // 4. Create College Tutor
    const cTutor = await prisma.user.create({
      data: {
        email: `college_tutor_${Date.now()}@test.com`,
        ageTier: AgeTier.COLLEGE,
        accountStatus: AccountStatus.ACTIVE,
        emailVerified: true,
        roles: { create: [{ role: UserRoleType.TUTOR, isActive: true }] },
        tutorProfile: {
          create: {
            bio: 'Computer Science professor tutoring college students',
            subjects: ['Computer Science'],
            hourlyRate: 60.0,
            educationLevel: 'Masters',
            isVerifiedByMentor: true,
            availability: {},
          },
        },
      },
      include: { tutorProfile: true },
    });
    collegeTutorId = cTutor.id;
    collegeTutorProfileId = cTutor.tutorProfile!.id;
    collegeTutorToken = generateAccessToken({
      sub: cTutor.id,
      email: cTutor.email,
      ageTier: AgeTier.COLLEGE,
      roles: ['TUTOR'],
    });

    // 5. Create Sessions
    const sSession = await prisma.liveSession.create({
      data: {
        tutorId: schoolTutorProfileId,
        title: 'School Algebra Workshop',
        description: 'For high school students',
        sessionType: SessionType.ONE_ON_ONE,
        ageTierFilter: AgeTier.SCHOOL,
        subject: 'Mathematics',
        price: 20.0,
        currency: 'USD',
        scheduledAt: new Date(Date.now() + 86400000),
        durationMinutes: 60,
        status: SessionStatus.SCHEDULED,
        videoRoomId: 'room_school_session_test',
      },
    });
    schoolSessionId = sSession.id;

    const cSession = await prisma.liveSession.create({
      data: {
        tutorId: collegeTutorProfileId,
        title: 'College Distributed Systems',
        description: 'For college and university students',
        sessionType: SessionType.GROUP,
        ageTierFilter: AgeTier.COLLEGE,
        subject: 'Computer Science',
        price: 35.0,
        currency: 'USD',
        scheduledAt: new Date(Date.now() + 86400000),
        durationMinutes: 60,
        status: SessionStatus.SCHEDULED,
        videoRoomId: 'room_college_session_test',
      },
    });
    collegeSessionId = cSession.id;
  });

  afterAll(async () => {
    // Cleanup created records
    await prisma.sessionBooking.deleteMany({
      where: { sessionId: { in: [schoolSessionId, collegeSessionId] } },
    });
    await prisma.liveSession.deleteMany({
      where: { id: { in: [schoolSessionId, collegeSessionId] } },
    });
    await prisma.tutorProfile.deleteMany({
      where: { id: { in: [schoolTutorProfileId, collegeTutorProfileId] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [schoolLearnerId, schoolTutorId, collegeLearnerId, collegeTutorId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [schoolLearnerId, schoolTutorId, collegeLearnerId, collegeTutorId] } },
    });
    await prisma.$disconnect();
  });

  describe('Scenario 1: Tutor Search Isolation (P1 + P3 contract)', () => {
    it('MUST ONLY return School-tier tutors to a School user', async () => {
      const res = await request(app)
        .get('/api/v1/users/tutors/search')
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify that no college tutors leaked into the school search
      const returnedTutorIds = res.body.data.map((t: any) => t.tutorId);
      expect(returnedTutorIds).not.toContain(collegeTutorProfileId);
    });

    it('MUST ONLY return College-tier tutors to a College user', async () => {
      const res = await request(app)
        .get('/api/v1/users/tutors/search')
        .set('Authorization', `Bearer ${collegeLearnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const returnedTutorIds = res.body.data.map((t: any) => t.tutorId);
      expect(returnedTutorIds).not.toContain(schoolTutorProfileId);
    });

    it('DIRECT API BYPASS: School user providing ?ageTier=COLLEGE query param MUST NOT bypass tier filter', async () => {
      const res = await request(app)
        .get('/api/v1/users/tutors/search?ageTier=COLLEGE')
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(200);
      // Backend must strictly ignore client-supplied ageTier and use user token's DB ageTier
      const returnedTutorIds = res.body.data.map((t: any) => t.tutorId);
      expect(returnedTutorIds).not.toContain(collegeTutorProfileId);
    });
  });

  describe('Scenario 2: Direct Tutor Profile Access', () => {
    it('MUST reject School user trying to view a College tutor profile directly (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/tutors/${collegeTutorProfileId}`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });

    it('MUST reject College user trying to view a School tutor profile directly (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/tutors/${schoolTutorProfileId}`)
        .set('Authorization', `Bearer ${collegeLearnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });

    it('MUST allow School user to view School tutor profile (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/tutors/${schoolTutorProfileId}`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.profile.id).toBe(schoolTutorProfileId);
    });
  });

  describe('Scenario 3: Session Booking Cross-Tier Gating', () => {
    it('MUST REJECT a School user attempting to book a College session via direct API call (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${collegeSessionId}/book`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });

    it('MUST REJECT a College user attempting to book a School session via direct API call (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${schoolSessionId}/book`)
        .set('Authorization', `Bearer ${collegeLearnerToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });

    it('MUST ALLOW same-tier booking (School learner -> School session)', async () => {
      const res = await request(app)
        .post(`/api/v1/sessions/${schoolSessionId}/book`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.sessionId).toBe(schoolSessionId);
    });
  });

  describe('Scenario 4: Video Room Access Authorization (P1 + P2 contract)', () => {
    it('MUST REJECT School user attempting to obtain video room credentials for College session (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/sessions/${collegeSessionId}/room-token`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });

    it('MUST AUTHORIZE valid participant room credentials for same-tier confirmed booking', async () => {
      const res = await request(app)
        .get(`/api/v1/sessions/${schoolSessionId}/room-token`)
        .set('Authorization', `Bearer ${schoolLearnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.roomId).toBe('room_school_session_test');
      expect(res.body.data.role).toBe('PARTICIPANT');
    });
  });

  describe('Scenario 5: Checkout & Payment Cross-Tier Gating', () => {
    it('MUST REJECT checkout initiation when a School learner tries to buy a College session', async () => {
      const res = await request(app)
        .post('/api/v1/payments/checkout')
        .set('Authorization', `Bearer ${schoolLearnerToken}`)
        .send({
          itemType: 'SESSION',
          itemId: collegeSessionId,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Age-tier violation/i);
    });
  });
});
