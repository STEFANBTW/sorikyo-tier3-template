# ============================================================
# SoriKyo Tier 3 — Dockerfile
# Lightweight Node.js 20 Alpine container for Coolify deployment
# ============================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile --prod=false

# Generate Prisma client
COPY prisma ./prisma
RUN pnpm db:generate

# ─── Production Stage ────────────────────────────────────────

FROM node:20-alpine AS production

WORKDIR /app

# Copy production node_modules and generated Prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

# Copy application code
COPY server.js .
COPY client-config.json .
COPY public ./public

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/config/brand || exit 1

# Non-root user for security
RUN addgroup -S sorikyo && adduser -S sorikyo -G sorikyo
USER sorikyo

EXPOSE 3000

CMD ["node", "server.js"]
