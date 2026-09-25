/**
 * @file auth.ts
 * @description Authentication and authorization middleware.
 * Verifies JWT tokens, enforces active account status, checks role permissions,
 * and attaches user data with authoritative DB ageTier.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@/utils/jwt';
import { ApiError } from '@/middleware/errorHandler';
import { prisma } from '@/config/database';
import { UserRoleType, AgeTier, AccountStatus } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  ageTier: AgeTier;
  accountStatus: AccountStatus;
  roles: string[];
}

/**
 * Middleware: Verifies the JWT access token from the Authorization header.
 * Attaches the decoded user to `req.user`.
 * Authoritatively re-validates ageTier and accountStatus directly from DB.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyAccessToken(token);

    // Fetch user and active roles from DB
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          where: { isActive: true },
          select: { role: true },
        },
      },
    });

    if (!user || user.deletedAt !== null) {
      throw ApiError.unauthorized('User not found or account deactivated');
    }

    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw ApiError.forbidden('Account is suspended');
    }

    if (user.accountStatus === AccountStatus.BLOCKED) {
      throw ApiError.forbidden('Account is blocked');
    }

    const activeRoles = user.roles.map((r) => r.role as string);

    // SECURITY: Authoritative DB-backed ageTier and role list
    req.user = {
      id: user.id,
      email: user.email,
      ageTier: user.ageTier,
      accountStatus: user.accountStatus,
      roles: activeRoles,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication middleware: attaches req.user if a valid token is present,
 * but continues normally without error if no authorization header exists.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.slice(7).trim();
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          where: { isActive: true },
          select: { role: true },
        },
      },
    });

    if (user && user.deletedAt === null && user.accountStatus === AccountStatus.ACTIVE) {
      req.user = {
        id: user.id,
        email: user.email,
        ageTier: user.ageTier,
        accountStatus: user.accountStatus,
        roles: user.roles.map((r) => r.role as string),
      };
    }
  } catch {
    // Ignore invalid tokens in optional auth
  }

  next();
}

/**
 * Middleware factory: Requires the authenticated user to have at least one of the allowed roles.
 * Must be mounted AFTER requireAuth.
 */
export function requireRole(...allowedRoles: (UserRoleType | string)[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }

    const hasAllowedRole = req.user.roles.some((r) =>
      allowedRoles.includes(r as UserRoleType),
    );

    if (!hasAllowedRole) {
      return next(
        ApiError.forbidden(
          `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`,
        ),
      );
    }

    next();
  };
}
