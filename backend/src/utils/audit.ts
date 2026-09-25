/**
 * @file audit.ts
 * @description Audit-logging utility. Writes immutable audit entries to the
 * database for compliance and forensic analysis. Designed to be fire-and-forget
 * — it never throws or propagates errors to the caller.
 */

import { prisma } from '@/config/database';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for a single audit log entry */
export interface AuditOptions {
  /** ID of the user who performed the action (undefined for unauthenticated actions) */
  actorId?: string;
  /**
   * Verb-style action identifier.
   * Convention: `DOMAIN_VERB`, e.g. `AUTH_LOGIN`, `ROLE_ASSIGNED`, `PAYOUT_INITIATED`
   */
  action: string;
  /** The type of domain entity being acted upon, e.g. `'User'`, `'Payment'` */
  resource: string;
  /** Primary key of the affected entity */
  resourceId?: string;
  /** Arbitrary structured data relevant to the event */
  metadata?: Record<string, unknown>;
  /** Whether the action completed successfully */
  success: boolean;
  /** The incoming Express request – used to extract IP and User-Agent */
  req?: Request;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Write an audit log entry to the database.
 *
 * This function is intentionally non-throwing: audit-log failures must never
 * interrupt the main application flow. Errors are logged via the logger instead.
 *
 * @param options - Details of the event to record
 */
export async function auditLog(options: AuditOptions): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: options.actorId ?? null,
        action: options.action,
        resource: options.resource,
        resourceId: options.resourceId ?? null,
        metadata: (options.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: options.req?.ip ?? null,
        userAgent: (options.req?.headers['user-agent'] as string) ?? null,
        success: options.success,
      },
    });
  } catch (error) {
    // Audit log failure must never break the main request flow
    logger.error('Failed to write audit log', { error, options });
  }
}
