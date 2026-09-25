/**
 * @file globalTeardown.ts
 * @description Jest global teardown — runs ONCE after the entire test suite.
 *
 * Disconnects the Prisma client to allow Jest to exit cleanly.
 */

export default async function globalTeardown(): Promise<void> {
  console.log('[globalTeardown] Test suite complete. Cleaning up…');
  // If prisma client was used, disconnect here:
  // const { prisma } = await import('../src/config/database');
  // await prisma.$disconnect();
}
