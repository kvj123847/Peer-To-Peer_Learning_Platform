/**
 * @file tutors.service.ts
 * @description Service for managing tutor profiles, availability, and Stripe Connect onboarding.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { assertAgeTierCompatible } from '@/utils/ageTierGuard';
import { auditLog } from '@/utils/audit';
import { AgeTier, Prisma, StripeAccountStatus, KycStatus } from '@prisma/client';
import Stripe from 'stripe';
import { env } from '@/config/env';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20' as unknown as Stripe.LatestApiVersion,
});

export interface CreateTutorProfileDto {
  bio: string;
  subjects: string[];
  hourlyRate: number;
  currency?: string;
  yearsExperience?: number;
  educationLevel: string;
  university?: string;
  availability?: Record<string, unknown>;
}

export interface UpdateTutorProfileDto {
  bio?: string;
  subjects?: string[];
  hourlyRate?: number;
  currency?: string;
  yearsExperience?: number;
  educationLevel?: string;
  university?: string;
  availability?: Record<string, unknown>;
}

export interface TutorProfileDto {
  id: string;
  userId: string;
  ageTier: AgeTier;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  bio: string;
  subjects: string[];
  hourlyRate: number;
  currency: string;
  yearsExperience: number;
  educationLevel: string;
  university: string | null;
  availability: Record<string, unknown>;
  isVerifiedByMentor: boolean;
  stripeAccountStatus: StripeAccountStatus;
  kycStatus: KycStatus;
  totalSessions: number;
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
}

export class TutorsService {
  /**
   * Creates a tutor profile for an existing user.
   */
  async createProfile(
    userId: string,
    data: CreateTutorProfileDto,
    req?: Request,
  ): Promise<TutorProfileDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tutorProfile: true, roles: true },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    if (user.tutorProfile) {
      throw ApiError.conflict('Tutor profile already exists for this user');
    }

    const created = await prisma.tutorProfile.create({
      data: {
        userId,
        bio: data.bio,
        subjects: data.subjects,
        hourlyRate: new Prisma.Decimal(data.hourlyRate),
        currency: data.currency ?? 'USD',
        yearsExperience: data.yearsExperience ?? 0,
        educationLevel: data.educationLevel,
        university: data.university,
        availability: (data.availability ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        user: true,
      },
    });

    await auditLog({
      actorId: userId,
      action: 'TUTOR_PROFILE_CREATED',
      resource: 'TutorProfile',
      resourceId: created.id,
      success: true,
      req,
    });

    return this.mapToDto(created, user.ageTier, user.firstName, user.lastName, user.avatarUrl);
  }

  /**
   * Updates an existing tutor profile.
   */
  async updateProfile(
    userId: string,
    data: UpdateTutorProfileDto,
    req?: Request,
  ): Promise<TutorProfileDto> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor profile not found');
    }

    const updated = await prisma.tutorProfile.update({
      where: { id: tutor.id },
      data: {
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.subjects !== undefined && { subjects: data.subjects }),
        ...(data.hourlyRate !== undefined && { hourlyRate: new Prisma.Decimal(data.hourlyRate) }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.yearsExperience !== undefined && { yearsExperience: data.yearsExperience }),
        ...(data.educationLevel !== undefined && { educationLevel: data.educationLevel }),
        ...(data.university !== undefined && { university: data.university }),
        ...(data.availability !== undefined && {
          availability: data.availability as Prisma.InputJsonValue,
        }),
      },
      include: { user: true },
    });

    await auditLog({
      actorId: userId,
      action: 'TUTOR_PROFILE_UPDATED',
      resource: 'TutorProfile',
      resourceId: updated.id,
      success: true,
      req,
    });

    return this.mapToDto(
      updated,
      updated.user.ageTier,
      updated.user.firstName,
      updated.user.lastName,
      updated.user.avatarUrl,
    );
  }

  /**
   * SAFETY-CRITICAL: Retrieves a tutor profile by tutorId and enforces age-tier boundary.
   */
  async getProfile(tutorId: string, requestingUserAgeTier: AgeTier): Promise<TutorProfileDto> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { id: tutorId },
      include: { user: true },
    });

    if (!tutor || tutor.user.deletedAt !== null) {
      throw ApiError.notFound('Tutor not found');
    }

    // STRICT AGE-TIER VERIFICATION
    assertAgeTierCompatible(requestingUserAgeTier, tutor.user.ageTier, 'viewing tutor profile');

    return this.mapToDto(
      tutor,
      tutor.user.ageTier,
      tutor.user.firstName,
      tutor.user.lastName,
      tutor.user.avatarUrl,
    );
  }

  /**
   * Retrieves availability schedule for a tutor.
   */
  async getAvailability(tutorId: string, requestingUserAgeTier: AgeTier) {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { id: tutorId },
      include: { user: { select: { ageTier: true } } },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor not found');
    }

    assertAgeTierCompatible(requestingUserAgeTier, tutor.user.ageTier, 'checking tutor availability');

    return {
      tutorId: tutor.id,
      availability: tutor.availability,
    };
  }

  /**
   * Generates a Stripe Connect Custom/Express onboarding link for the tutor.
   */
  async initiateStripeConnectOnboarding(
    userId: string,
    returnUrl: string,
    refreshUrl: string,
    req?: Request,
  ): Promise<{ onboardingUrl: string }> {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!tutor) {
      throw ApiError.notFound('Tutor profile not found');
    }

    let accountId = tutor.stripeAccountId;

    if (!accountId) {
      // Create Stripe Express account
      const account = await stripe.accounts.create({
        type: 'express',
        email: tutor.user.email,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
      });

      accountId = account.id;

      await prisma.tutorProfile.update({
        where: { id: tutor.id },
        data: {
          stripeAccountId: accountId,
          stripeAccountStatus: StripeAccountStatus.PENDING,
          kycStatus: KycStatus.PENDING,
        },
      });
    }

    // Create onboarding account link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || `${env.CLIENT_URL}/tutor/onboarding/refresh`,
      return_url: returnUrl || `${env.CLIENT_URL}/tutor/onboarding/complete`,
      type: 'account_onboarding',
    });

    await auditLog({
      actorId: userId,
      action: 'STRIPE_CONNECT_ONBOARDING_INITIATED',
      resource: 'TutorProfile',
      resourceId: tutor.id,
      metadata: { stripeAccountId: accountId },
      success: true,
      req,
    });

    return { onboardingUrl: accountLink.url };
  }

  private mapToDto(
    tutor: any,
    ageTier: AgeTier,
    firstName: string | null,
    lastName: string | null,
    avatarUrl: string | null,
  ): TutorProfileDto {
    return {
      id: tutor.id,
      userId: tutor.userId,
      ageTier,
      firstName,
      lastName,
      avatarUrl,
      bio: tutor.bio,
      subjects: tutor.subjects,
      hourlyRate: Number(tutor.hourlyRate),
      currency: tutor.currency,
      yearsExperience: tutor.yearsExperience,
      educationLevel: tutor.educationLevel,
      university: tutor.university,
      availability: tutor.availability as Record<string, unknown>,
      isVerifiedByMentor: tutor.isVerifiedByMentor,
      stripeAccountStatus: tutor.stripeAccountStatus,
      kycStatus: tutor.kycStatus,
      totalSessions: tutor.totalSessions,
      totalEarnings: Number(tutor.totalEarnings),
      avgRating: tutor.avgRating ? Number(tutor.avgRating) : null,
      reviewCount: tutor.reviewCount,
    };
  }
}
