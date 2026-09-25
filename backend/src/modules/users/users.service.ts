/**
 * @file users.service.ts
 * @description User profile management, password updates, and age-tier filtered tutor discovery.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { hashPassword, comparePassword } from '@/utils/crypto';
import { ApiError } from '@/middleware/errorHandler';
import { auditLog } from '@/utils/audit';
import { AgeTier, AccountStatus } from '@prisma/client';

export interface UserRoleDto {
  id: string;
  role: string;
  createdAt: Date;
}

export interface EmbeddedTutorProfileDto {
  id: string;
  bio: string | null;
  subjects: string[];
  hourlyRate: number | null;
  currency: string;
  isVerified: boolean;
  averageRating: number | null;
}

export interface UserDetailDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  ageTier: AgeTier;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: UserRoleDto[];
  tutorProfile: EmbeddedTutorProfileDto | null;
}

export interface TutorListItemDto {
  tutorId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  subjects: string[];
  hourlyRate: number | null;
  currency: string;
  averageRating: number | null;
  totalReviews: number;
  yearsExperience: number;
  isVerified: boolean;
}

export interface TutorSearchFilters {
  subject?: string;
  minRating?: number;
  maxHourlyRate?: number;
  minHourlyRate?: number;
  yearsExperience?: number;
  isVerified?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

export class UserService {
  /**
   * Retrieves a user's full profile including roles and tutor profile.
   */
  async getUserProfile(userId: string): Promise<UserDetailDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        roles: {
          where: { isActive: true },
          select: { id: true, role: true, createdAt: true },
        },
        tutorProfile: true,
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      ageTier: user.ageTier,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.roles.map((r) => ({ id: r.id, role: r.role, createdAt: r.createdAt })),
      tutorProfile: user.tutorProfile
        ? {
            id: user.tutorProfile.id,
            bio: user.tutorProfile.bio,
            subjects: user.tutorProfile.subjects,
            hourlyRate: user.tutorProfile.hourlyRate ? Number(user.tutorProfile.hourlyRate) : null,
            currency: user.tutorProfile.currency,
            isVerified: user.tutorProfile.isVerifiedByMentor,
            averageRating: user.tutorProfile.avgRating ? Number(user.tutorProfile.avgRating) : null,
          }
        : null,
    };
  }

  /**
   * Updates basic profile information.
   */
  async updateProfile(
    userId: string,
    data: UpdateProfileDto,
    req?: Request,
  ): Promise<UserDetailDto> {
    const exists = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!exists) {
      throw ApiError.notFound('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
    });

    await auditLog({
      actorId: userId,
      action: 'USER_PROFILE_UPDATED',
      resource: 'User',
      resourceId: userId,
      metadata: { updatedFields: Object.keys(data) },
      success: true,
      req,
    });

    return this.getUserProfile(userId);
  }

  /**
   * Changes the user's password and revokes active sessions.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    req?: Request,
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user || !user.passwordHash) {
      throw ApiError.badRequest('Password authentication is not configured for this account');
    }

    const isMatch = await comparePassword(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw ApiError.badRequest('Current password is incorrect');
    }

    const newHashed = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHashed },
    });

    // Invalidate refresh tokens
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    await auditLog({
      actorId: userId,
      action: 'USER_PASSWORD_CHANGED',
      resource: 'User',
      resourceId: userId,
      success: true,
      req,
    });
  }

  /**
   * Soft-deletes user account.
   */
  async deleteAccount(userId: string, req?: Request): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        accountStatus: AccountStatus.BLOCKED,
      },
    });

    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    await auditLog({
      actorId: userId,
      action: 'USER_ACCOUNT_DELETED',
      resource: 'User',
      resourceId: userId,
      success: true,
      req,
    });
  }

  /**
   * SAFETY-CRITICAL: Search tutors strictly constrained to the requesting user's age tier.
   * School users ONLY get School tutors. College users ONLY get College tutors.
   */
  async searchTutors(
    requestingUserAgeTier: AgeTier,
    filters: TutorSearchFilters,
  ): Promise<PaginatedResult<TutorListItemDto>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 10));
    const skip = (page - 1) * pageSize;

    // Hard data-level filter on User.ageTier matching the requester
    const whereClause: Record<string, unknown> = {
      user: {
        ageTier: requestingUserAgeTier, // CRITICAL NON-NEGOTIABLE FILTER
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
      },
    };

    if (filters.subject) {
      whereClause.subjects = {
        has: filters.subject,
      };
    }

    if (filters.minRating !== undefined) {
      whereClause.avgRating = {
        gte: filters.minRating,
      };
    }

    if (filters.minHourlyRate !== undefined || filters.maxHourlyRate !== undefined) {
      whereClause.hourlyRate = {
        ...(filters.minHourlyRate !== undefined && { gte: filters.minHourlyRate }),
        ...(filters.maxHourlyRate !== undefined && { lte: filters.maxHourlyRate }),
      };
    }

    if (filters.yearsExperience !== undefined) {
      whereClause.yearsExperience = {
        gte: filters.yearsExperience,
      };
    }

    if (filters.isVerified !== undefined) {
      whereClause.isVerifiedByMentor = filters.isVerified;
    }

    const [tutors, total] = await Promise.all([
      prisma.tutorProfile.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
              ageTier: true,
            },
          },
        },
        orderBy: { avgRating: 'desc' },
      }),
      prisma.tutorProfile.count({ where: whereClause }),
    ]);

    const data: TutorListItemDto[] = tutors.map((t) => ({
      tutorId: t.id,
      userId: t.user.id,
      firstName: t.user.firstName,
      lastName: t.user.lastName,
      avatarUrl: t.user.avatarUrl,
      bio: t.bio,
      subjects: t.subjects,
      hourlyRate: t.hourlyRate ? Number(t.hourlyRate) : null,
      currency: t.currency,
      averageRating: t.avgRating ? Number(t.avgRating) : null,
      totalReviews: t.reviewCount,
      yearsExperience: t.yearsExperience,
      isVerified: t.isVerifiedByMentor,
    }));

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Admin status update.
   */
  async updateAccountStatus(
    targetUserId: string,
    status: AccountStatus,
    actorId: string,
    req?: Request,
  ): Promise<void> {
    await prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: status },
    });

    await auditLog({
      actorId,
      action: 'ADMIN_USER_STATUS_UPDATED',
      resource: 'User',
      resourceId: targetUserId,
      metadata: { newStatus: status },
      success: true,
      req,
    });
  }

  /**
   * Returns a sanitized public profile for a user.
   */
  async getPublicProfile(userId: string): Promise<Partial<UserDetailDto>> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        bio: true,
        avatarUrl: true,
        ageTier: true,
        tutorProfile: {
          select: {
            id: true,
            bio: true,
            subjects: true,
            hourlyRate: true,
            currency: true,
            avgRating: true,
            reviewCount: true,
            yearsExperience: true,
            isVerifiedByMentor: true,
          },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      ageTier: user.ageTier,
      tutorProfile: user.tutorProfile
        ? {
            id: user.tutorProfile.id,
            bio: user.tutorProfile.bio,
            subjects: user.tutorProfile.subjects,
            hourlyRate: user.tutorProfile.hourlyRate ? Number(user.tutorProfile.hourlyRate) : null,
            currency: user.tutorProfile.currency,
            isVerified: user.tutorProfile.isVerifiedByMentor,
            averageRating: user.tutorProfile.avgRating ? Number(user.tutorProfile.avgRating) : null,
          }
        : null,
    };
  }
}

