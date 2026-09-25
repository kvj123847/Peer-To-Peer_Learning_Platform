/**
 * @file roles.service.ts
 * @description Role management service: ensures role boundaries are strictly enforced server-side.
 */

import { Request } from 'express';
import { prisma } from '@/config/database';
import { ApiError } from '@/middleware/errorHandler';
import { auditLog } from '@/utils/audit';
import { UserRoleType, AccountStatus, Prisma } from '@prisma/client';

export interface UserRoleDto {
  id: string;
  role: string;
  grantedAt: Date;
}

export class RolesService {
  /**
   * Returns all active roles for a given user.
   */
  async getUserRoles(userId: string): Promise<UserRoleDto[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        roles: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, createdAt: true },
        },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    return user.roles.map((r) => ({
      id: r.id,
      role: r.role,
      grantedAt: r.createdAt,
    }));
  }

  /**
   * Grants a role to a user.
   * Only LEARNER and TUTOR roles are self-assignable.
   * MENTOR is never self-assignable (requires verified credentials).
   */
  async addRole(
    userId: string,
    role: 'LEARNER' | 'TUTOR',
    actorId: string,
    req?: Request,
  ): Promise<UserRoleDto[]> {
    const SELF_ASSIGNABLE_ROLES: string[] = ['LEARNER', 'TUTOR'];
    if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
      throw ApiError.forbidden(`Role '${role}' cannot be self-assigned`);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { where: { isActive: true } },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw ApiError.forbidden('Account is not active');
    }

    const alreadyHasRole = user.roles.some((r) => r.role === role);
    if (alreadyHasRole) {
      throw ApiError.conflict(`User already possesses the '${role}' role`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.userRole.create({
        data: {
          userId,
          role: role as UserRoleType,
          isActive: true,
        },
      });

      if (role === 'TUTOR') {
        const existing = await tx.tutorProfile.findUnique({
          where: { userId },
        });

        if (!existing) {
          await tx.tutorProfile.create({
            data: {
              userId,
              bio: `Tutor profile in ${user.ageTier} tier.`,
              subjects: [],
              hourlyRate: new Prisma.Decimal(25.0),
              currency: 'USD',
              yearsExperience: 0,
              educationLevel: user.ageTier === 'SCHOOL' ? 'High School' : 'Undergraduate',
              availability: {},
            },
          });
        }
      }
    });

    await auditLog({
      actorId,
      action: 'ROLE_ADDED',
      resource: 'UserRole',
      resourceId: userId,
      metadata: { role, targetUserId: userId },
      success: true,
      req,
    });

    return this.getUserRoles(userId);
  }

  /**
   * Revokes an active role from a user.
   */
  async removeRole(
    userId: string,
    role: 'LEARNER' | 'TUTOR',
    actorId: string,
    req?: Request,
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { where: { isActive: true } },
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    const targetRoleRecord = user.roles.find((r) => r.role === role);
    if (!targetRoleRecord) {
      throw ApiError.notFound(`User does not have the '${role}' role`);
    }

    if (user.roles.length <= 1) {
      throw ApiError.conflict('Cannot remove the user\'s only remaining active role');
    }

    await prisma.userRole.update({
      where: { id: targetRoleRecord.id },
      data: { isActive: false },
    });

    await auditLog({
      actorId,
      action: 'ROLE_REMOVED',
      resource: 'UserRole',
      resourceId: userId,
      metadata: { role, roleRecordId: targetRoleRecord.id },
      success: true,
      req,
    });
  }

  /**
   * Checks if user has a specific role in DB.
   */
  async hasRole(userId: string, role: string): Promise<boolean> {
    const count = await prisma.userRole.count({
      where: {
        userId,
        role: role as UserRoleType,
        isActive: true,
      },
    });
    return count > 0;
  }
}
