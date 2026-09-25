/**
 * @file tests/__mocks__/database.ts
 * @description In-memory Prisma mock for the test environment.
 *
 * `@prisma-mock/prismock` provides a PrismockClient that is a full
 * drop-in replacement for PrismaClient, storing all data in memory.
 * No PostgreSQL server is required — tests are fast and fully isolated.
 *
 * Jest picks this file up automatically via the `moduleNameMapper` entry
 * in jest.config.ts that redirects `@/config/database` here.
 */

import { PrismockClient } from 'prismock';

export const prisma = new PrismockClient();

/** No-op: prismock doesn't need an actual connection. */
export async function connectDatabase(): Promise<void> {
  // intentional no-op
}

/** Resets in-memory data after the test suite completes. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
