# Peer-To-Peer Learning Platform

A safety-first, peer-to-peer student learning and mentorship platform engineered with hard age-tier separation, verified mentor review workflows, video session access authorization, and Stripe Connect tutor payouts.

---

## 🏗️ Repository Architecture

This repository is organized into multi-lead components:

| Component | Lead | Status | Description |
|---|---|:---:|---|
| **[`backend/`](./backend)** | **Person 1** (Backend + Security Lead) | ✅ Complete | Node.js, TypeScript, Express, PostgreSQL, Prisma, JWT + OAuth, Stripe |
| **`video/`** | **Person 2** (Video Lead) | 🔄 Next | WebRTC, LiveKit / Agora signaling, recording & room token management |
| **`mobile/`** | **Person 3** (Mobile Lead) | 🔄 Next | Cross-platform mobile app (React Native / Flutter) |

---

## 🛡️ Core Highlights (Person 1 — Backend & Security)

1. **Hard Age-Tier Segregation (Safety-Critical)**
   - Strict segregation: `School (<18) ↔ School` only; `College (18+) ↔ College` only.
   - Enforced at database query layer, service layer, and middleware.
   - Client parameter manipulation (`?ageTier=...`) is ignored server-side.

2. **Authentication & Session Security**
   - Native email/password authentication with password complexity constraints.
   - Google OAuth 2.0 & Apple Sign-In support.
   - Short-lived JWT access tokens + rotating refresh tokens with replay-attack revocation.

3. **Role Management & Mentor Workflow**
   - Server-enforced role assignments (`LEARNER`, `TUTOR`, `MENTOR`).
   - Content verification pipeline: `DRAFT` ➔ `PENDING_REVIEW` ➔ `APPROVED / REJECTED` ➔ `PUBLISHED`.
   - Rejections require structured mentor feedback (10+ characters).

4. **Payments & Tutor Ledger**
   - Stripe PaymentIntent integration for sessions, courses, and doubts.
   - 20% platform cut / 80% tutor net ledger automated split.
   - Minor guardian approval requirement for school-tier tutors requesting payouts.

5. **Cross-Team API Contracts**
   - Detailed specifications documented in [`backend/docs/API_CONTRACTS_P1_P2_P3.md`](./backend/docs/API_CONTRACTS_P1_P2_P3.md).

---

## 🚀 Getting Started (Backend)

### Prerequisites
- Node.js (v20+ recommended)
- npm or yarn

### Installation
```bash
cd backend
npm install
npx prisma generate
```

### Run Tests
```bash
npm test
```

### Production Build
```bash
npm run build
```

---

## 📄 License
UNLICENSED — Proprietary startup codebase.
