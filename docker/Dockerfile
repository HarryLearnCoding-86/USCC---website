# docker/Dockerfile
# Production image for USCC Referee Results Web (AGENT_PROMPT.md Phase 5, NFR-15). Multi-stage:
#   dependencies → builder (pnpm install, prisma generate, next build) →
#   tools  : full dependencies and sources; runs migrations, `pnpm admin:create` and the seed (one-off containers)
#   runner : the minimal Next.js standalone server, run as a non-root user.
# Debian slim (not Alpine) because Prisma's engines and argon2's prebuilt binary target glibc.
# Build: docker compose -f docker-compose.prod.yml build

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# pnpm version comes from "packageManager" in package.json via corepack.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# postinstall runs `prisma generate` against the copied schema.
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NEXT_OUTPUT_STANDALONE=true
RUN pnpm build

FROM builder AS tools
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIRECTORY=/app/storage/uploads
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/storage/uploads \
  && chown -R nextjs:nodejs /app/storage
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# TCP check only: there is deliberately no public health route (CLAUDE.md §2: no public routes).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
