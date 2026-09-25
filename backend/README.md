# Peer-to-Peer Student Learning App — Backend Engine

> **Owner**: Person 1 (Backend + Security Lead)  
> **Target**: Production-grade, highly secure, modular Node.js/TypeScript backend for the P2P Student Learning Mobile Platform.

---

## Architecture Highlights

1. **Hard Age-Tier Segregation (Safety-Critical)**:
   - School (<18) ↔ School only; College (18+) ↔ College only.
   - Enforced at query and middleware level (`src/middleware/ageTier.ts` & `src/utils/ageTierGuard.ts`).
2. **Authentication & Session Security**:
   - JWT access tokens (15m) + refresh token rotation (7d) with automatic reuse detection.
   - Native Google & Apple Sign-In support for iOS and Android App Store compliance.
3. **Role & Permission Management**:
   - Multi-role support (`LEARNER`, `TUTOR`, `MENTOR`) enforced server-side.
4. **Mentor Review Workflow**:
   - State machine: `DRAFT` → `PENDING_REVIEW` → `APPROVED` / `REJECTED` (with mandatory feedback) → `PUBLISHED`.
5. **Monetary Flows & Ledger**:
   - Stripe PaymentIntent checkout for courses, sessions, and chat doubt sessions.
   - Automated 20% platform fee calculation and real-time tutor earnings ledger.
   - Stripe Connect express transfers with KYC checks and minor guardian safeguards.
6. **Cross-Lead Contracts (P1 ↔ P2 ↔ P3)**:
   - Full API integration documentation in [`docs/API_CONTRACTS_P1_P2_P3.md`](./docs/API_CONTRACTS_P1_P2_P3.md).

---

## Directory Structure

```
backend/
├── prisma/
│   ├── schema.prisma          # Authoritative relational database schema
│   └── seed.ts                # Test accounts & sample course/session seed
├── src/
│   ├── config/                # Environment validation (Zod), Prisma client, logger
│   ├── middleware/            # Auth, Authorize, AgeTier, RateLimiter, ErrorHandler
│   ├── modules/
│   │   ├── auth/              # Signup, login, OAuth, refresh rotation, passwords
│   │   ├── users/             # Profiles, account lifecycle, age-filtered search
│   │   ├── roles/             # Server-enforced role assignments
│   │   ├── tutors/            # Tutor profiles, availability, Stripe onboarding
│   │   ├── mentorReview/      # Review queue, approval/rejection state machine
│   │   ├── payments/          # Checkout, webhooks, fee ledger, payouts
│   │   └── sessions/          # Booking and video room access token verification
│   ├── utils/                 # Cryptography, JWT, Audit logging, Age-tier guards, Email
│   ├── app.ts                 # Express application & middleware stack
│   └── server.ts              # HTTP server & graceful shutdown lifecycle
├── tests/
│   ├── ageTier.test.ts        # Dedicated security audit for cross-tier bypass
│   ├── auth.test.ts           # Authentication & token rotation tests
│   ├── mentorReview.test.ts   # Mentor workflow tests
│   ├── payments.test.ts       # Ledger and payout tests
│   └── setup.ts               # Test environment mocks
├── docs/
│   └── API_CONTRACTS_P1_P2_P3.md # Team contract specifications
├── docker-compose.yml         # Local PostgreSQL, Redis, Adminer, App setup
└── Dockerfile                 # Multi-stage production container
```

---

## Quickstart

### Option A: Running with Docker (Recommended)
```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start PostgreSQL, Redis, Adminer, and the Backend API
docker-compose up --build
```
- API will be accessible at: `http://localhost:3000`
- Database Adminer UI: `http://localhost:8080`

---

### Option B: Running Locally with Node.js
```bash
# 1. Install dependencies
npm install

# 2. Setup PostgreSQL database and run migrations
npm run db:generate
npm run db:migrate

# 3. Seed demo accounts
npm run db:seed

# 4. Start in development mode with hot reloading
npm run dev
```

---

## Running Test Suites

```bash
# Run all test suites
npm test

# Run dedicated safety audit tests (Age-Tier Bypass Scenarios)
npm test -- tests/ageTier.test.ts

# Run auth tests
npm test -- tests/auth.test.ts
```
