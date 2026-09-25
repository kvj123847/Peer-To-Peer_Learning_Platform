/**
 * @file setup.ts
 * @description Jest test setup environment: configures environment variables,
 * mocks third-party outbound HTTP services (Stripe, SendGrid, Google OAuth),
 * and provides test lifecycle helpers.
 */

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.API_VERSION = 'v1';
// Point Prisma at a local PostgreSQL test database.
// The DB must exist before running tests. See README for setup instructions.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/p2p_learning_test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_that_is_at_least_32_chars!!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_that_is_at_least_32_chars!';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_key_for_testing_only';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_placeholder';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test_placeholder';
process.env.SENDGRID_API_KEY = 'SG.test_key_for_testing_purposes_only';
process.env.SENDGRID_FROM_EMAIL = 'support@p2plearning.example.com';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.ADMIN_URL = 'http://localhost:3000/admin';
process.env.GOOGLE_CLIENT_ID = 'test_google_client_id';
process.env.GOOGLE_CLIENT_SECRET = 'test_google_client_secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3001/api/v1/auth/google/callback';
process.env.APPLE_CLIENT_ID = 'com.test.app';
process.env.APPLE_TEAM_ID = 'TESTTEAMID';
process.env.APPLE_KEY_ID = 'TESTKEYID1';
process.env.APPLE_PRIVATE_KEY_PATH = './secrets/apple_auth_key.p8';
process.env.APPLE_CALLBACK_URL = 'http://localhost:3001/api/v1/auth/apple/callback';

import { Prisma } from '@prisma/client';

// Polyfill structuredClone to support Prisma.Decimal instances which cannot be cloned by native structuredClone
const originalStructuredClone = global.structuredClone;

function safeStructuredClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as any;
  if (Prisma?.Decimal && Prisma.Decimal.isDecimal(obj)) return new Prisma.Decimal((obj as any).toString()) as any;
  if (Array.isArray(obj)) return (obj as any).map(safeStructuredClone);
  try {
    return originalStructuredClone ? originalStructuredClone(obj) : obj;
  } catch {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj as object)) {
      out[k] = safeStructuredClone((obj as any)[k]);
    }
    return out as any;
  }
}

(global as any).structuredClone = safeStructuredClone;

// Global mock for SendGrid to avoid external network calls in unit/integration tests
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
}));

