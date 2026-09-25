/**
 * @file auth.test.ts
 * @description Comprehensive unit and integration test suite for authentication and session management:
 * - Local signup with age-tier and role initialization
 * - Password complexity enforcement
 * - Login credential validation
 * - Refresh token rotation & reuse detection
 * - Role permission assignments
 */

import request from 'supertest';
import app from '@/app';
import { prisma } from '@/config/database';
import { AgeTier } from '@prisma/client';

describe('Auth & Session Management', () => {
  const testEmail = `auth_test_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  afterAll(async () => {
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.tutorProfile.deleteMany({ where: { userId } });
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should reject signup with weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'weakpass@example.com',
          password: 'pass',
          ageTier: 'COLLEGE',
          role: 'LEARNER',
          firstName: 'Weak',
          lastName: 'Pass',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should register a new college tutor successfully', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: testEmail,
          password: testPassword,
          ageTier: 'COLLEGE',
          role: 'TUTOR',
          firstName: 'John',
          lastName: 'Doe',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.user.ageTier).toBe(AgeTier.COLLEGE);
      expect(res.body.data.user.roles).toContain('TUTOR');
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      userId = res.body.data.user.id;
      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    it('should reject signup with an existing email address (409)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: testEmail,
          password: testPassword,
          ageTier: 'COLLEGE',
          role: 'LEARNER',
          firstName: 'Duplicate',
          lastName: 'User',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should fail with incorrect password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should log in successfully with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      // Update active token pair
      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return current user profile with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(userId);
      expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
    });

    it('should reject request without Bearer token (401)', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh (Rotation & Reuse Detection)', () => {
    let newRefreshToken: string;

    it('should rotate tokens and return a fresh access + refresh pair', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.refreshToken).not.toBe(refreshToken);

      newRefreshToken = res.body.data.refreshToken;
    });

    it('SECURITY: Reusing an invalidated refresh token should be rejected (403)', async () => {
      // Attempting to reuse the old `refreshToken` that was already rotated
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Compromised token detected/i);
    });
  });
});
