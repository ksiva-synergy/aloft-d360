# Web app image for Elastic Beanstalk / ECS: Vite + React Router UI served by the Next.js standalone server (UI + API, one container)
# Build from repo root: docker build -t aloft-d360-web -f Dockerfile .
#
# deps and builder are pinned to BUILDPLATFORM. CI runs on an x86 GitHub runner
# and publishes linux/arm64 for t4g; without this, Buildx emulates npm ci, Vite,
# and next build under QEMU (about 25 min vs about 3 min native). The runner
# stage stays on TARGETPLATFORM so the image Node binary matches t4g.

FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
COPY packages ./packages
COPY prisma ./prisma
# GHA sets NODE_ENV=production; @aloft/shared build needs devDependencies (tsup).
RUN npm ci --include=dev

FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@aloft/shared
# `npm run build` first builds the Vite UI into public/spa (npm `prebuild`: web/scripts/prepare-spa.mjs), then `next build`.
# Next.js serves the SPA for every page URL and keeps serving /api/**.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
USER nextjs
CMD ["node", "server.js"]
