# AnhourLeads application image (deploy/docker-compose.prod.yml): the app and the scheduler run from it.
#
# A full copy of the built project rather than the `standalone` output: the scheduler runs the same
# server code with tsx (`npm run scheduler`), and the entrypoint applies the drizzle/ migrations.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# husky's `prepare` hook needs git; it is skipped in the image.
RUN HUSKY=0 npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 APP_PROTOCOL=https
# tsx is a runtime dependency (the scheduler runs server code with it).
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
# Reported as `version` by GET /api/health.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3410 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S anhour && adduser -S anhour -G anhour
COPY --from=build --chown=anhour:anhour /app/package.json /app/package-lock.json /app/next.config.mjs /app/tsconfig.json ./
COPY --from=build --chown=anhour:anhour /app/node_modules ./node_modules
COPY --from=build --chown=anhour:anhour /app/.next ./.next
COPY --from=build --chown=anhour:anhour /app/drizzle ./drizzle
COPY --from=build --chown=anhour:anhour /app/scripts ./scripts
COPY --from=build --chown=anhour:anhour /app/src ./src
USER anhour
EXPOSE 3410
# Liveness only (no database or Redis): compose and orchestrators restart a hung process.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3410/api/health || exit 1
# Checks required settings, waits for Postgres + Redis, applies migrations (unless SKIP_MIGRATIONS=true),
# then starts the app. `node scripts/docker-entrypoint.mjs migrate` = migrations only (one-off jobs).
CMD ["node", "scripts/docker-entrypoint.mjs"]
