# ─────────────────────────────────────────────────────────────
# Multi-stage production Dockerfile
# Stage 1: deps    — install production + dev dependencies
# Stage 2: builder — compile TypeScript to JavaScript
# Stage 3: runner  — minimal image, runs as non-root user
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install all dependencies ────────────────────────
FROM node:20-alpine AS deps

# Install build tools needed for native addons (bcrypt, etc.)
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Copy only package manifests first (better layer caching)
COPY package.json package-lock.json* ./
COPY prisma/schema.prisma ./prisma/schema.prisma

# Install ALL deps (including devDeps needed for build)
RUN npm ci --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# ── Stage 2: TypeScript compilation ──────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY . .

# Re-generate Prisma client in builder context
RUN npx prisma generate

# Compile TypeScript → JavaScript (runs tsc then tsc-alias for path aliases)
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────
FROM node:20-alpine AS runner

# Labels for container metadata
LABEL org.opencontainers.image.title="P2P Learning Backend"
LABEL org.opencontainers.image.description="Peer-to-Peer Student Learning App API"

RUN apk add --no-cache libc6-compat dumb-init

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 expressjs

# Copy only production node_modules (reinstall cleanly)
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile --only=production && npm cache clean --force

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Ensure logs directory exists and is writable by expressjs user
RUN mkdir -p logs && chown expressjs:nodejs logs

# Switch to non-root user
USER expressjs

EXPOSE 3000

# dumb-init handles PID 1 signal forwarding for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
