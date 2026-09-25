/**
 * @file env.ts
 * @description Environment variable validation using Zod.
 *
 * This module runs at application startup. If any required environment
 * variable is missing or invalid, the process exits with a clear, actionable
 * error message listing every failing field — preventing silent runtime
 * failures caused by misconfigured deployments.
 *
 * In `test` mode, external-service variables (OAuth, Stripe, SendGrid) are
 * made optional and replaced with safe dummy defaults so the test suite can
 * boot without real credentials.
 */

import { z, ZodError } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Makes a string field optional in test mode, falling back to a safe default. */
const testOptional = (defaultVal: string) =>
  z.string().optional().default(defaultVal);

/** Checks whether we are currently running inside the Jest test runner. */
const isTest = process.env.NODE_ENV === 'test';

// ─────────────────────────────────────────────────────────────────────────────
// Schema definition
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Server ──────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.string().default('3000').transform(Number),
  API_VERSION: z.string().default('v1'),

  // ── Database ─────────────────────────────────────────────────────────────
  /** Full PostgreSQL connection string. */
  DATABASE_URL: isTest
    ? testOptional('postgresql://postgres:postgres@localhost:5432/p2p_test')
    : z.string().url({ message: 'DATABASE_URL must be a valid URL' }),

  // ── JWT ──────────────────────────────────────────────────────────────────
  /** Minimum 32-character secret for signing short-lived access tokens. */
  JWT_ACCESS_SECRET: isTest
    ? testOptional('test_access_secret_that_is_at_least_32_chars!!')
    : z
        .string()
        .min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' }),
  /** Minimum 32-character secret for signing long-lived refresh tokens. */
  JWT_REFRESH_SECRET: isTest
    ? testOptional('test_refresh_secret_that_is_at_least_32_chars!')
    : z
        .string()
        .min(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' }),
  /** Duration string accepted by `jsonwebtoken` (e.g. "15m", "1h"). */
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  /** Duration string accepted by `jsonwebtoken` (e.g. "7d", "30d"). */
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // ── Google OAuth 2.0 ─────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: isTest
    ? testOptional('test_google_client_id')
    : z.string().min(1, { message: 'GOOGLE_CLIENT_ID is required' }),
  GOOGLE_CLIENT_SECRET: isTest
    ? testOptional('test_google_client_secret')
    : z.string().min(1, { message: 'GOOGLE_CLIENT_SECRET is required' }),
  GOOGLE_CALLBACK_URL: isTest
    ? testOptional('http://localhost:3000/api/v1/auth/google/callback')
    : z.string().url({ message: 'GOOGLE_CALLBACK_URL must be a valid URL' }),

  // ── Apple Sign In ────────────────────────────────────────────────────────
  APPLE_CLIENT_ID: isTest
    ? testOptional('com.test.app')
    : z.string().min(1, { message: 'APPLE_CLIENT_ID is required' }),
  APPLE_TEAM_ID: isTest
    ? testOptional('TESTTEAMID')
    : z.string().min(1, { message: 'APPLE_TEAM_ID is required' }),
  APPLE_KEY_ID: isTest
    ? testOptional('TESTKEYID1')
    : z.string().min(1, { message: 'APPLE_KEY_ID is required' }),
  APPLE_PRIVATE_KEY_PATH: isTest
    ? testOptional('./secrets/apple_auth_key.p8')
    : z.string().min(1, { message: 'APPLE_PRIVATE_KEY_PATH is required' }),
  APPLE_CALLBACK_URL: isTest
    ? testOptional('https://localhost:3000/api/v1/auth/apple/callback')
    : z.string().url({ message: 'APPLE_CALLBACK_URL must be a valid URL' }),

  // ── Stripe ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: isTest
    ? testOptional('sk_test_placeholder_key_for_testing_only')
    : z.string().startsWith('sk_', { message: 'STRIPE_SECRET_KEY must start with sk_' }),
  STRIPE_WEBHOOK_SECRET: isTest
    ? testOptional('whsec_test_placeholder')
    : z.string().min(1, { message: 'STRIPE_WEBHOOK_SECRET is required' }),
  STRIPE_CONNECT_WEBHOOK_SECRET: isTest
    ? testOptional('whsec_connect_test_placeholder')
    : z.string().min(1, { message: 'STRIPE_CONNECT_WEBHOOK_SECRET is required' }),

  // ── SendGrid ─────────────────────────────────────────────────────────────
  SENDGRID_API_KEY: isTest
    ? testOptional('SG.test_placeholder_api_key')
    : z.string().startsWith('SG.', { message: 'SENDGRID_API_KEY must start with SG.' }),
  SENDGRID_FROM_EMAIL: isTest
    ? testOptional('noreply@test.com')
    : z.string().email({ message: 'SENDGRID_FROM_EMAIL must be a valid email' }),

  // ── App URLs ─────────────────────────────────────────────────────────────
  CLIENT_URL: isTest
    ? testOptional('http://localhost:3001')
    : z.string().url({ message: 'CLIENT_URL must be a valid URL' }),
  ADMIN_URL: isTest
    ? testOptional('http://localhost:3002')
    : z.string().url({ message: 'ADMIN_URL must be a valid URL' }),

  // ── Redis (optional) ─────────────────────────────────────────────────────
  /** Connection URL for Redis. Used for token blacklisting and rate limiting. */
  REDIS_URL: z
    .string()
    .url({ message: 'REDIS_URL must be a valid URL' })
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse & export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses and validates all environment variables at module load time.
 *
 * @throws {Error} If any required variable is missing or invalid in non-test mode.
 */
function parseEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.errors
        .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      console.error(
        `\n❌  Environment validation failed. Fix the following variables in your .env file:\n\n${issues}\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}

/** Validated, typed environment configuration. Imported throughout the app. */
export const env = parseEnv();

/** TypeScript type of the validated env object. */
export type Env = z.infer<typeof envSchema>;
