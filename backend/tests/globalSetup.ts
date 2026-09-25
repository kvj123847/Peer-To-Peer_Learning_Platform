/**
 * @file globalSetup.ts
 * @description Jest global setup — runs ONCE before the entire test suite.
 *
 * In CI / local dev without a live DB, this is intentionally a no-op.
 * When DATABASE_URL points to a real PostgreSQL instance, you could run
 * `prisma migrate deploy` here to ensure the schema is up-to-date.
 */

export default async function globalSetup(): Promise<void> {
  // Prisma / DB connection is established per-test via the singleton
  // prisma client in src/config/database.ts.
  // No bootstrap work needed here for unit-level tests.
  console.log('\n[globalSetup] Test suite starting…');
}
