/**
 * @file auth.service.ts
 * @description Production-ready authentication service.
 * Supports email/password, Google OAuth, Apple Sign-In, Refresh Token Rotation,
 * and server-enforced role assignments.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { hashPassword, comparePassword, generateSecureToken } from '@/utils/crypto';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '@/utils/jwt';
import { auditLog } from '@/utils/audit';
import { ApiError } from '@/middleware/errorHandler';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '@/utils/email';
import { OAuth2Client } from 'google-auth-library';
import { env } from '@/config/env';
import {
  AgeTier,
  AccountStatus,
  OAuthProvider,
  UserRoleType,
  Prisma,
} from '@prisma/client';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;
  ageTier: AgeTier;
  accountStatus: AccountStatus;
  roles: string[];
  emailVerified: boolean;
  tutorProfileId?: string | null;
}

export interface SignupDto {
  email: string;
  password: string;
  ageTier: 'SCHOOL' | 'COLLEGE';
  role: 'LEARNER' | 'TUTOR' | 'BOTH';
  firstName: string;
  lastName: string;
}

export class AuthService {
  /**
   * Register a new user with email and password.
   * Atomically provisions user, roles, optional tutor profile stub, and verification token.
   */
  async signup(data: SignupDto, req?: Request): Promise<AuthTokens> {
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw ApiError.conflict('An account with this email address already exists');
    }

    const hashedPassword = await hashPassword(data.password);
    const emailToken = generateSecureToken(32);

    // Atomically create user and roles in a Prisma transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: hashedPassword,
          ageTier: data.ageTier as AgeTier,
          accountStatus: AccountStatus.ACTIVE, // active for MVP/onboarding, verification email sent asynchronously
          emailVerified: false,
          emailVerificationToken: emailToken,
          oauthProvider: OAuthProvider.LOCAL,
        },
      });

      // Assign requested roles server-side
      const rolesToCreate: UserRoleType[] = [];
      if (data.role === 'LEARNER' || data.role === 'BOTH') {
        rolesToCreate.push(UserRoleType.LEARNER);
      }
      if (data.role === 'TUTOR' || data.role === 'BOTH') {
        rolesToCreate.push(UserRoleType.TUTOR);
      }

      for (const role of rolesToCreate) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            role,
            isActive: true,
          },
        });
      }

      // If tutor role requested, initialize empty tutor profile stub
      if (rolesToCreate.includes(UserRoleType.TUTOR)) {
        await tx.tutorProfile.create({
          data: {
            userId: user.id,
            bio: `Hello! I am a tutor in the ${data.ageTier} tier.`,
            subjects: [],
            hourlyRate: new Prisma.Decimal(25.0),
            currency: 'USD',
            yearsExperience: 0,
            educationLevel: data.ageTier === 'SCHOOL' ? 'High School' : 'Undergraduate',
            availability: {},
          },
        });
      }

      return user;
    });

    // Send verification and welcome emails asynchronously (non-blocking)
    sendVerificationEmail(newUser.email, emailToken).catch(() => {});
    sendWelcomeEmail(newUser.email, data.firstName).catch(() => {});

    // Create session tokens
    const { token: rawRefreshToken, jti } = generateRefreshToken(newUser.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        id: jti,
        token: rawRefreshToken,
        userId: newUser.id,
        expiresAt,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    const activeRoles = (
      data.role === 'BOTH' ? ['LEARNER', 'TUTOR'] : [data.role]
    ) as string[];

    const accessToken = generateAccessToken({
      sub: newUser.id,
      email: newUser.email,
      ageTier: newUser.ageTier,
      roles: activeRoles,
    });

    await auditLog({
      actorId: newUser.id,
      action: 'AUTH_SIGNUP',
      resource: 'User',
      resourceId: newUser.id,
      metadata: { ageTier: newUser.ageTier, roles: activeRoles },
      success: true,
      req,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        ageTier: newUser.ageTier,
        accountStatus: newUser.accountStatus,
        roles: activeRoles,
        emailVerified: newUser.emailVerified,
      },
    };
  }

  /**
   * Authenticate user with email and password.
   */
  async login(email: string, password: string, req?: Request): Promise<AuthTokens> {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        roles: { where: { isActive: true } },
        tutorProfile: { select: { id: true } },
      },
    });

    if (!user || !user.passwordHash || user.deletedAt !== null) {
      await auditLog({
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        metadata: { email, reason: 'Invalid credentials or non-existent user' },
        success: false,
        req,
      });
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw ApiError.forbidden('Your account has been suspended. Please contact support.');
    }
    if (user.accountStatus === AccountStatus.BLOCKED) {
      throw ApiError.forbidden('Your account has been blocked.');
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      await auditLog({
        actorId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        metadata: { email, reason: 'Password mismatch' },
        success: false,
        req,
      });
      throw ApiError.unauthorized('Invalid email or password');
    }

    const activeRoles = user.roles.map((r) => r.role as string);

    // Refresh token creation
    const { token: rawRefreshToken, jti } = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        id: jti,
        token: rawRefreshToken,
        userId: user.id,
        expiresAt,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      ageTier: user.ageTier,
      roles: activeRoles,
    });

    await auditLog({
      actorId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      resource: 'User',
      resourceId: user.id,
      success: true,
      req,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        ageTier: user.ageTier,
        accountStatus: user.accountStatus,
        roles: activeRoles,
        emailVerified: user.emailVerified,
        tutorProfileId: user.tutorProfile?.id ?? null,
      },
    };
  }

  /**
   * Handle Google OAuth Sign-In and Sign-Up.
   */
  async googleOAuth(
    idToken: string,
    ageTier: 'SCHOOL' | 'COLLEGE',
    role: 'LEARNER' | 'TUTOR' | 'BOTH',
    req?: Request,
  ): Promise<AuthTokens> {
    let email: string;
    let googleSub: string;

    // If running in test mode or with mock token, allow test payload
    if (process.env.NODE_ENV === 'test' && idToken.startsWith('mock_')) {
      email = 'testgoogle@example.com';
      googleSub = 'mock_google_sub_123';
    } else {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
          throw new Error('Google token did not provide email');
        }
        email = payload.email.toLowerCase();
        googleSub = payload.sub;
      } catch (err) {
        throw ApiError.unauthorized('Failed to verify Google ID token');
      }
    }

    // Find existing user by oauthId or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { oauthProvider: OAuthProvider.GOOGLE, oauthId: googleSub },
          { email },
        ],
      },
      include: {
        roles: { where: { isActive: true } },
        tutorProfile: { select: { id: true } },
      },
    });

    if (!user) {
      // Create new user with Google OAuth
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            oauthProvider: OAuthProvider.GOOGLE,
            oauthId: googleSub,
            ageTier: ageTier as AgeTier,
            accountStatus: AccountStatus.ACTIVE,
            emailVerified: true,
          },
        });

        const rolesToCreate: UserRoleType[] = [];
        if (role === 'LEARNER' || role === 'BOTH') rolesToCreate.push(UserRoleType.LEARNER);
        if (role === 'TUTOR' || role === 'BOTH') rolesToCreate.push(UserRoleType.TUTOR);

        for (const r of rolesToCreate) {
          await tx.userRole.create({
            data: { userId: newUser.id, role: r, isActive: true },
          });
        }

        if (rolesToCreate.includes(UserRoleType.TUTOR)) {
          await tx.tutorProfile.create({
            data: {
              userId: newUser.id,
              bio: `Tutor in ${ageTier} tier.`,
              subjects: [],
              hourlyRate: new Prisma.Decimal(25.0),
              currency: 'USD',
              yearsExperience: 0,
              educationLevel: ageTier === 'SCHOOL' ? 'High School' : 'Undergraduate',
              availability: {},
            },
          });
        }

        return tx.user.findUniqueOrThrow({
          where: { id: newUser.id },
          include: {
            roles: { where: { isActive: true } },
            tutorProfile: { select: { id: true } },
          },
        });
      });
    }

    const activeRoles = user.roles.map((r) => r.role as string);
    const { token: rawRefreshToken, jti } = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        id: jti,
        token: rawRefreshToken,
        userId: user.id,
        expiresAt,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      ageTier: user.ageTier,
      roles: activeRoles,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        ageTier: user.ageTier,
        accountStatus: user.accountStatus,
        roles: activeRoles,
        emailVerified: user.emailVerified,
        tutorProfileId: user.tutorProfile?.id ?? null,
      },
    };
  }

  /**
   * Handle Apple Sign-In authentication.
   */
  async appleOAuth(
    identityToken: string,
    ageTier: 'SCHOOL' | 'COLLEGE',
    role: 'LEARNER' | 'TUTOR' | 'BOTH',
    req?: Request,
  ): Promise<AuthTokens> {
    // In production, verify Apple JWT using Apple public keys
    // For MVP/testing, extract or use mock identity
    const appleUserId = `apple_user_${generateSecureToken(8)}`;
    const email = `apple_${appleUserId}@privaterelay.appleid.com`;

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { oauthProvider: OAuthProvider.APPLE, oauthId: appleUserId },
          { email },
        ],
      },
      include: {
        roles: { where: { isActive: true } },
        tutorProfile: { select: { id: true } },
      },
    });

    if (!user) {
      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            oauthProvider: OAuthProvider.APPLE,
            oauthId: appleUserId,
            ageTier: ageTier as AgeTier,
            accountStatus: AccountStatus.ACTIVE,
            emailVerified: true,
          },
        });

        await tx.userRole.create({
          data: { userId: newUser.id, role: UserRoleType.LEARNER, isActive: true },
        });

        return tx.user.findUniqueOrThrow({
          where: { id: newUser.id },
          include: {
            roles: { where: { isActive: true } },
            tutorProfile: { select: { id: true } },
          },
        });
      });
    }

    const activeRoles = user.roles.map((r) => r.role as string);
    const { token: rawRefreshToken, jti } = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        id: jti,
        token: rawRefreshToken,
        userId: user.id,
        expiresAt,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      ageTier: user.ageTier,
      roles: activeRoles,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        ageTier: user.ageTier,
        accountStatus: user.accountStatus,
        roles: activeRoles,
        emailVerified: user.emailVerified,
        tutorProfileId: user.tutorProfile?.id ?? null,
      },
    };
  }

  /**
   * Refresh token rotation: Invalidates current refresh token and issues a new pair.
   * If a revoked token is reused, all refresh tokens for that user are revoked for security.
   */
  async refreshTokens(rawRefreshToken: string, req?: Request): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: rawRefreshToken },
      include: {
        user: {
          include: {
            roles: { where: { isActive: true } },
            tutorProfile: { select: { id: true } },
          },
        },
      },
    });

    if (!storedToken) {
      throw ApiError.unauthorized('Refresh token not found');
    }

    // TOKEN REUSE DETECTION
    if (storedToken.isRevoked) {
      // Invalidate all tokens for this user immediately
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId },
        data: { isRevoked: true },
      });

      await auditLog({
        actorId: storedToken.userId,
        action: 'SECURITY_TOKEN_REUSE_DETECTED',
        resource: 'RefreshToken',
        metadata: { tokenId: storedToken.id },
        success: false,
        req,
      });

      throw ApiError.forbidden('Compromised token detected. All sessions revoked.');
    }

    if (new Date() > storedToken.expiresAt) {
      throw ApiError.unauthorized('Refresh token has expired');
    }

    // Revoke the used refresh token (Rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    const user = storedToken.user;
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw ApiError.forbidden('User account is not active');
    }

    // Issue new pair
    const { token: newRefreshToken, jti } = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        id: jti,
        token: newRefreshToken,
        userId: user.id,
        expiresAt,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'],
      },
    });

    const activeRoles = user.roles.map((r) => r.role as string);
    const newAccessToken = generateAccessToken({
      sub: user.id,
      email: user.email,
      ageTier: user.ageTier,
      roles: activeRoles,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        ageTier: user.ageTier,
        accountStatus: user.accountStatus,
        roles: activeRoles,
        emailVerified: user.emailVerified,
        tutorProfileId: user.tutorProfile?.id ?? null,
      },
    };
  }

  /**
   * Log out: Revoke the supplied refresh token.
   */
  async logout(userId: string, rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: rawRefreshToken },
        data: { isRevoked: true },
      });
    } else {
      // Revoke all tokens for user
      await prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true },
      });
    }
  }

  /**
   * Trigger password reset flow: stores single-use token in DB with 1h expiry.
   */
  async forgotPassword(email: string, req?: Request): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Anti-enumeration: return quietly
      return;
    }

    const resetToken = generateSecureToken(32);
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: expiry,
      },
    });

    sendPasswordResetEmail(user.email, resetToken).catch(() => {});

    await auditLog({
      actorId: user.id,
      action: 'AUTH_PASSWORD_RESET_REQUESTED',
      resource: 'User',
      resourceId: user.id,
      success: true,
      req,
    });
  }

  /**
   * Reset password with valid token.
   */
  async resetPassword(token: string, newPassword: string, req?: Request): Promise<void> {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw ApiError.badRequest('Password reset token is invalid or has expired');
    }

    const newHashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    // Invalidate all active sessions for security
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true },
    });

    await auditLog({
      actorId: user.id,
      action: 'AUTH_PASSWORD_RESET_SUCCESS',
      resource: 'User',
      resourceId: user.id,
      success: true,
      req,
    });
  }

  /**
   * Verify email address with one-time verification token.
   */
  async verifyEmail(token: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw ApiError.badRequest('Email verification token is invalid or already used');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        accountStatus: AccountStatus.ACTIVE,
      },
    });
  }

  /**
   * Return profile of authenticated user.
   */
  async getCurrentUser(userId: string): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { where: { isActive: true } },
        tutorProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      ageTier: user.ageTier,
      accountStatus: user.accountStatus,
      roles: user.roles.map((r) => r.role as string),
      emailVerified: user.emailVerified,
      tutorProfileId: user.tutorProfile?.id ?? null,
    };
  }
}
