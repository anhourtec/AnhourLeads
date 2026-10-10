# Deployment guide

How to run AnhourLeads in production on one server with Docker, from an empty machine to the first sign-in. Hostnames and certificates in depth: [domains-and-ssl.md](./domains-and-ssl.md).

---

## What you are deploying

| Piece | What it is | Notes |
| --- | --- | --- |
| **app** | `deploy/Dockerfile` (`node:22-alpine`), Next.js on port **3410** inside the network | Health: `GET /api/health` (liveness), `GET /api/health/ready` (Postgres + Redis). JSON logs on stdout. Applies migrations on start |
| **scheduler** | Same image, `npm run scheduler` | Runs every job in `src/server/jobs/registry.ts` (hostname re-checks, crawling, sequences) on its interval. Run exactly one |
| **postgres** | `postgres:17-alpine` | All data. Volume `postgres-data` |
| **redis** | `redis:7-alpine` with a password, append-only | Caches, rate limits, locks. Losing it clears caches; no data loss |
| **nginx** | `nginx:stable-alpine` | Terminates TLS, restores the client address, adds `X-Request-Id`, proxies every hostname to the app. The only service with published ports (80, 443) |
| **certbot** | `deploy/certbot/` (profile `letsencrypt`) | Let's Encrypt certificates for the primary hosts and verified workspace hostnames |

## 1. Server

- A Linux server with a public IPv4 address, 2 vCPU and 4 GB RAM or more, 20 GB+ disk.
- Docker Engine with the compose plugin (`docker compose version`).
- Firewall: 22 (SSH, from your address only), 80 and 443 from anywhere (or from Cloudflare's ranges only, behind Cloudflare). Nothing else.
- A DNS name for the installation, e.g. `leads.example.com`: an `A` (and `AAAA` if you have IPv6) record pointing at the server.

## 2. Get the code

```bash
git clone <your fork or the project repository> anhourleads
cd anhourleads/deploy
cp ../.env.example .env
chmod 600 .env
```

`deploy/.env` lives only on the server (gitignored). Every container reads it.

## 3. Fill in `deploy/.env`

`DATABASE_URL` and `REDIS_URL` in this file are **ignored**: compose builds them from `POSTGRES_*` / `REDIS_PASSWORD` and points them at the `postgres` / `redis` containers.

### Secrets (generate on the server)

Use hex for anything that ends up in a URL, so nothing needs escaping:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)"
```

Paste each line into `.env`, then store all four in your password manager. Changing `BETTER_AUTH_SECRET` signs everyone out; losing `SECRETS_ENCRYPTION_KEY` makes saved mailbox passwords unreadable; `POSTGRES_PASSWORD` is fixed once the database volume exists.

### Hostname and proxy

```
BETTER_AUTH_URL=https://leads.example.com
APP_PRIMARY_HOSTS=leads.example.com
APP_DOMAIN_TARGET=leads.example.com
APP_ALLOW_SIGNUP=false
LOG_LEVEL=info
```

`APP_PROTOCOL=https` and `APP_TRUST_PROXY=true` are set by the compose file. `APP_PRIMARY_HOSTS` is where people sign in to the installation; `APP_DOMAIN_TARGET` is what workspaces point their CNAME at. `APP_ALLOW_SIGNUP=false` makes the installation invite-only; leave it `true` if anyone may create a workspace.

### Outgoing mail

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASSWORD=<password>
SMTP_FROM="AnhourLeads <no-reply@example.com>"
```

Used for invitations and password resets. Outreach is sent from each workspace's own mailboxes.

### HTTPS: choose one

**Let's Encrypt on this server** (any DNS provider):

```
NGINX_CONF=letsencrypt
COMPOSE_PROFILES=letsencrypt
APP_TLS_PROVIDER=nginx
ACME_EMAIL=ops@example.com
ACME_STAGING=true
```

`ACME_STAGING=true` on the first run issues untrusted test certificates, which proves DNS and port 80 work without touching Let's Encrypt's rate limits. Set it back to `false` and restart certbot (`docker compose -f docker-compose.prod.yml up -d certbot`): the sync replaces the test certificates by itself.

**Behind Cloudflare:**

```
NGINX_CONF=cloudflare
COMPOSE_PROFILES=
APP_TLS_PROVIDER=cloudflare
```

plus the Origin CA certificate in `deploy/certs/origin.pem` and `deploy/certs/origin-key.pem`. Full steps: [domains-and-ssl.md → Cloudflare for SaaS](./domains-and-ssl.md#cloudflare-for-saas-option).

### Platform administrator

`SEED_PLATFORM_ADMIN_*` are for the local demo seed only; don't run `npm run db:seed` in production. Create the first account by signing up (with `APP_ALLOW_SIGNUP=true` for the first sign-up), then give it platform administration once:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U anhour -d anhourleads -c "update \"user\" set role = 'admin' where email = 'you@example.com';"
```

Set `APP_ALLOW_SIGNUP=false` afterwards if the installation is invite-only, and restart the app.

### Minimal `deploy/.env` (Let's Encrypt)

```
POSTGRES_USER=anhour
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=anhourleads
REDIS_PASSWORD=<openssl rand -hex 24>
BETTER_AUTH_SECRET=<openssl rand -base64 48>
SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32>

BETTER_AUTH_URL=https://leads.example.com
APP_PRIMARY_HOSTS=leads.example.com
APP_DOMAIN_TARGET=leads.example.com
APP_ALLOW_SIGNUP=true

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASSWORD=<password>
SMTP_FROM="AnhourLeads <no-reply@example.com>"

NGINX_CONF=letsencrypt
COMPOSE_PROFILES=letsencrypt
APP_TLS_PROVIDER=nginx
ACME_EMAIL=ops@example.com
ACME_STAGING=true
```

## 4. Check and start

```bash
docker compose -f docker-compose.prod.yml config --quiet   # the configuration is complete
./build.sh                                                  # clean build, start, wait until healthy
```

`build.sh` checks the configuration, stops the stack, removes old `anhourleads/app` images, builds without cache, starts everything and waits for the app's healthcheck. On start the app container (`scripts/docker-entrypoint.mjs`):

1. checks required settings and names any that are missing (values are never printed),
2. waits for Postgres and Redis (`STARTUP_WAIT_SECONDS`, default 60),
3. applies the migrations in `drizzle/` (skip with `SKIP_MIGRATIONS=true`; `node scripts/docker-entrypoint.mjs migrate` runs them alone),
4. starts the server on 3410 and forwards SIGTERM / SIGINT.

NGINX starts once the app is healthy; the scheduler once the app is healthy; certbot once NGINX is up.

## 5. First sign-in

1. `docker compose -f docker-compose.prod.yml logs -f certbot` shows `leads.example.com: certificate issued` within a minute (with `ACME_STAGING=true` the browser warns: expected). Switch to real certificates as above.
2. Open `https://leads.example.com/auth/register`, create your account and workspace, and make it platform administrator (above).
3. `https://leads.example.com/api/health/ready` returns 200 with `postgres: ok, redis: ok`.
4. **Platform** (`/dashboard/platform`): set each workspace's custom hostname limit.
5. **Settings → Branding** and **Settings → Domains** in a workspace: set the brand, add a hostname, add its DNS records, Verify now. Its certificate follows within about 15 minutes.

## Operations

| Task | Command (in `deploy/`) |
| --- | --- |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` (also `scheduler`, `nginx`, `certbot`) |
| Find one request | `docker compose -f docker-compose.prod.yml logs app nginx \| grep <X-Request-Id>` |
| Update | `git pull && ./build.sh` |
| Re-check hostnames now | `docker compose -f docker-compose.prod.yml exec scheduler npm run --silent domains:recheck` |
| Issue certificates now | `docker compose -f docker-compose.prod.yml exec certbot /opt/anhourleads/sync-certs.sh` |
| Reload NGINX | `docker compose -f docker-compose.prod.yml exec nginx sh -c 'nginx -t && nginx -s reload'` |
| Refresh Cloudflare ranges | `nginx/update-cloudflare-ips.sh`, review the diff, reload NGINX |
| Back up the database | `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U anhour -Fc anhourleads > anhourleads-$(date +%F).dump` |
| Restore | `docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U anhour -d anhourleads --clean < file.dump` |

**Monitoring:** probe `https://<primary host>/api/health/ready` (503 = Postgres or Redis down); ship stdout JSON logs and alert on `"level":"error"` and `status` ≥ 500. The scheduler's container is unhealthy when its heartbeat (`/tmp/scheduler-heartbeat`) is older than 2 minutes; its log has one `job finished` / `job failed` line per run.

**Scaling out:** the scheduler must run once. Several app replicas behind a load balancer work (state is in Postgres and Redis), but certbot's per-host files only fit a single NGINX server; use Cloudflare for fleets.

## Environment variables (production)

| Variable | Example / rule |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `anhour`, hex secret, `anhourleads` (compose builds `DATABASE_URL`) |
| `REDIS_PASSWORD` | hex secret (compose builds `REDIS_URL`) |
| `BETTER_AUTH_SECRET` | 32+ random characters |
| `BETTER_AUTH_URL` | `https://leads.example.com` |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32`; never change without re-entering mailbox passwords |
| `APP_PRIMARY_HOSTS` | `leads.example.com` |
| `APP_DOMAIN_TARGET` | `leads.example.com` |
| `APP_TLS_PROVIDER` | `nginx` or `cloudflare` |
| `APP_ALLOW_SIGNUP` | `true` or `false` |
| `SMTP_*` | system mail (invitations, password resets) |
| `NGINX_CONF`, `COMPOSE_PROFILES`, `ACME_EMAIL`, `ACME_STAGING`, `CERT_SYNC_INTERVAL` | see [domains-and-ssl.md](./domains-and-ssl.md#environment-variables) |
| `SKIP_MIGRATIONS`, `STARTUP_WAIT_SECONDS` | entrypoint |
| `SCHEDULER_JOBS`, `SCHEDULER_HEARTBEAT_FILE` | scheduler: run only some jobs (comma-separated names); heartbeat path |
| `LOG_LEVEL` | `info` |
| `GIT_SHA` | build argument, set by `build.sh`; shown as `version` by `/api/health` |

Never in production: `CRAWLER_ALLOW_PRIVATE_HOSTS=true`, `APP_TLS_PROVIDER=none`, Mailpit, the demo seed.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created: single-server Docker deployment from server set-up to first sign-in |
