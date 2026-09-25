/**
 * @file ageTierGuard.ts
 * @description SAFETY-CRITICAL utility for enforcing age-tier segregation.
 *
 * School (<18) users may ONLY interact with other School-tier content and users.
 * College (18+) users may ONLY interact with other College-tier content and users.
 * Cross-tier interactions are strictly PROHIBITED.
 */

import { AgeTier } from '@prisma/client';

// ---------------------------------------------------------------------------
// Pure compatibility check
// ---------------------------------------------------------------------------

/**
 * SAFETY-CRITICAL: Check whether two age tiers are compatible for interaction.
 *
 * School users may only interact with School-tier content.
 * College users may only interact with College-tier content.
 * Cross-tier interactions are always rejected.
 *
 * @param tierA - Age tier of the requesting user
 * @param tierB - Age tier of the target resource / user
 * @returns `true` if the interaction is permitted, `false` otherwise
 */
export function isAgeTierCompatible(tierA: AgeTier, tierB: AgeTier): boolean {
  return tierA === tierB;
}

// ---------------------------------------------------------------------------
// Assertive guard (throws on violation)
// ---------------------------------------------------------------------------

/**
 * SAFETY-CRITICAL: Assert that two age tiers are compatible.
 * Throws an {@link AgeTierViolationError} (HTTP 403) if they differ.
 *
 * @param tierA   - Age tier of the requesting user
 * @param tierB   - Age tier of the target resource / user
 * @param context - Human-readable description of where the check occurs,
 *                  included in the error message for debugging
 * @throws {AgeTierViolationError} if `tierA !== tierB`
 *
 * @example
 * assertAgeTierCompatible(req.user.ageTier, session.ageTierFilter, 'session booking');
 */
export function assertAgeTierCompatible(
  tierA: AgeTier,
  tierB: AgeTier,
  context: string,
): void {
  if (!isAgeTierCompatible(tierA, tierB)) {
    throw new AgeTierViolationError(
      `Age-tier violation in ${context}: ${tierA} user cannot interact with ${tierB} content/session.`,
    );
  }
}

import { ApiError } from '@/middleware/errorHandler';

/**
 * Thrown when a user attempts to cross age-tier boundaries.
 * Maps to HTTP 403 Forbidden.
 */
export class AgeTierViolationError extends ApiError {
  /** Machine-readable error code */
  public readonly code = 'AGE_TIER_VIOLATION';

  constructor(message: string) {
    super(403, message);
    this.name = 'AgeTierViolationError';
    // Maintain proper prototype chain for `instanceof` checks
    Object.setPrototypeOf(this, AgeTierViolationError.prototype);
  }
}
