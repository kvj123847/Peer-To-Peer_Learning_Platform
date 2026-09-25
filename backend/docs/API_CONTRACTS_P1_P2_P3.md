# Peer-to-Peer Student Learning App
## Complete API Contracts & Integration Guide: Person 1 (Backend) ↔ Person 2 (Video) ↔ Person 3 (Mobile)

This document establishes the authoritative contracts and specifications built by **Person 1 (Backend + Security Lead)** to coordinate with **Person 2 (Video + Session Lead)** and **Person 3 (Mobile + Content Lead)**.

---

## 1. System Roles & Responsibilities

| Role | Lead | Domain & Ownership |
|---|---|---|
| **Person 1** | **Backend + Security Lead** | APIs, Database, Authentication, Authorization, Hard Age-Tier Segregation, Mentor Review Workflow, Payment Ledger & Payouts. |
| **Person 2** | **Video + Session Lead** | Real-time WebRTC/SDK video engine (1-on-1 & Group), Room lifecycle, Connection handling, Chat sessions, Notification triggers. |
| **Person 3** | **Mobile + Content Lead** | Cross-platform Mobile App (React Native/Flutter), Learner & Tutor UX, Content library authoring/reader, Payment UI, Video call screen integration. |

---

## 2. Global Safety Architecture: Hard Age-Tier Segregation

> [!IMPORTANT]
> **Safety Rule**: `School (<18) ↔ School` is permitted; `College (18+) ↔ College` is permitted. `School ↔ College` is strictly **PROHIBITED** across search, chat, bookings, video rooms, and payments.

### Enforcement Rules:
1. **Server-Side Authoritative**: The user's `ageTier` (`SCHOOL` or `COLLEGE`) is read strictly from the authenticated database record (or signed JWT). Client-supplied query/body parameters claiming another age-tier are disregarded.
2. **Search & Recommendation Isolation**: `GET /api/v1/users/tutors/search` automatically injects `where: { user: { ageTier: req.user.ageTier } }`.
3. **Session Booking & Room Gating**: Any booking creation or room token issuance validates `req.user.ageTier === targetResource.ageTierFilter`. Mismatches immediately return `403 Forbidden` with error code `AGE_TIER_VIOLATION`.

---

## 3. Detailed Endpoint Contracts

### 3.1 Authentication & Profile (Person 1 ↔ Person 3)

#### `POST /api/v1/auth/signup`
- **Request Body**:
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "ageTier": "SCHOOL", // "SCHOOL" | "COLLEGE"
  "role": "LEARNER",   // "LEARNER" | "TUTOR" | "BOTH"
  "firstName": "Alex",
  "lastName": "Johnson"
}
```
- **Response `201 Created`**:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "ageTier": "SCHOOL",
      "accountStatus": "ACTIVE",
      "roles": ["LEARNER"],
      "emailVerified": false
    }
  }
}
```

#### `POST /api/v1/auth/login`
- **Request Body**: `{ "email": "...", "password": "..." }`
- **Response `200 OK`**: Returns `{ accessToken, refreshToken, user }`. Sets `refreshToken` cookie.

#### `POST /api/v1/auth/google` & `POST /api/v1/auth/apple`
- Native mobile SDK sends ID token to backend for cryptographic verification and session token issuance.

---

### 3.2 Tutor Search & Profiles (Person 1 ↔ Person 3)

#### `GET /api/v1/users/tutors/search`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Params**: `subject`, `minRating`, `maxHourlyRate`, `page`, `pageSize`
- **Response**: Filtered paginated list containing **only** tutors matching `req.user.ageTier`.

#### `GET /api/v1/tutors/:tutorId`
- Protected by `ageTierCheck('tutor')`. If a School user queries a College tutor ID, responds with `403 AGE_TIER_VIOLATION`.

---

### 3.3 Live Sessions, Bookings & Video Room Gating (Person 1 ↔ Person 2 ↔ Person 3)

#### `POST /api/v1/sessions`
- **Owner**: Tutor (via Person 3 screen)
- **Request**:
```json
{
  "title": "A-Level Calculus Review",
  "description": "Covering derivatives and integrals",
  "sessionType": "GROUP", // "ONE_ON_ONE" | "GROUP"
  "subject": "Mathematics",
  "maxParticipants": 6,
  "price": 20.0,
  "currency": "USD",
  "scheduledAt": "2026-10-01T15:00:00Z",
  "durationMinutes": 60
}
```

#### `POST /api/v1/sessions/:sessionId/book`
- **Owner**: Learner
- **Behavior**: Backend verifies age-tier compatibility, room capacity, and active status before creating `SessionBooking`.

#### `GET /api/v1/sessions/:sessionId/room-token`
- **Contract with Person 2 (Video Lead)**:
  - Person 2's mobile call interface calls this endpoint before connecting to the Agora/Twilio/LiveKit video room.
  - Person 1 validates participant authorization and age-tier integrity.
- **Response `200 OK`**:
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "roomId": "room_abc123",
    "userId": "uuid",
    "role": "HOST", // "HOST" | "PARTICIPANT"
    "userAgeTier": "SCHOOL",
    "sessionAgeTier": "SCHOOL",
    "authorizedAt": "2026-10-01T15:00:00Z",
    "sessionTitle": "A-Level Calculus Review"
  }
}
```

---

### 3.4 Mentor Review Workflow (Person 1 ↔ Person 3)

```
Tutor Submits (PENDING_REVIEW)
       ↓
Mentor Queue (GET /api/v1/mentor/queue)
       ↓
Mentor Decides (PATCH /approve OR /reject with feedback)
       ↓
If Approved: Tutor calls POST /:contentId/publish → PUBLISHED
```

#### Endpoints:
- `POST /api/v1/mentor/submit` — `{ contentId, contentType: "COURSE" | "SESSION" }` (Tutor)
- `GET /api/v1/mentor/queue` — Returns pending items for verified mentors (Mentor only)
- `PATCH /api/v1/mentor/:reviewId/approve` — Marks item approved (Mentor only)
- `PATCH /api/v1/mentor/:reviewId/reject` — Requires `{ feedback: "minimum 10 chars" }` (Mentor only)
- `POST /api/v1/mentor/:contentType/:contentId/publish` — Transitions status to `PUBLISHED` (Tutor only)

---

### 3.5 Payments & Tutor Payout Ledger (Person 1 ↔ Person 2 ↔ Person 3)

#### `POST /api/v1/payments/checkout`
- **Request**: `{ "itemType": "COURSE" | "SESSION" | "CHAT", "itemId": "uuid" }`
- **Response**: `{ paymentId, clientSecret, amount, currency }`
- **Fulfillment**: 20% platform fee retained; 80% credited to tutor's available earnings ledger.

#### `GET /api/v1/payments/earnings`
- Returns `{ availableBalance, pendingBalance, totalEarned, currency, earnings[] }`.

#### `POST /api/v1/payments/payout`
- **Request**: `{ "amount": 100.0, "currency": "USD" }`
- **Compliance Rules**:
  1. Connected Stripe account must have `kycStatus === 'VERIFIED'`.
  2. If tutor is `SCHOOL` tier (<18 minor), requires active guardian linkage record.
  3. Available balance must be ≥ requested amount.

---

## 4. Error Code Reference

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token. |
| `FORBIDDEN` | 403 | Missing required role or insufficient privilege. |
| `AGE_TIER_VIOLATION` | 403 | **SAFETY-CRITICAL**: Attempted cross-tier interaction. |
| `NOT_FOUND` | 404 | Resource not found or soft-deleted. |
| `CONFLICT` | 409 | Duplicate resource (e.g. email exists, already booked). |
| `RATE_LIMITED` | 429 | Rate limit exceeded. |
| `BAD_REQUEST` | 400 | Zod validation failure or illegal parameter. |
