# Handoff

The running log of where AnhourLeads stands, so the next session can pick up without digging through history. **Update it at the end of every working session** (CLAUDE.md rule 10): newest session first, what changed, what's verified, what's open.

How things work: [architecture.md](./architecture.md). Who can do what: [roles.md](./roles.md). Design rules: [../BRANDING.md](../BRANDING.md). Hostnames and HTTPS: [domains-and-ssl.md](./domains-and-ssl.md). Deploying: [deployment-guide.md](./deployment-guide.md). Migrations: [migration.md](./migration.md). Apollo API model: [reference/apollo-api.md](./reference/apollo-api.md).

---

## Current state (2026-10-10)

**Branch:** `feat/platform-foundation`, cut from local `main` (21 commits ahead, not pushed). All work is committed in focused conventional commits with no AI attribution.

**Checks at last commit:**

- `npx biome check .`: 662 files, clean. `npm run typecheck`: clean.
- `npm run test:api` (fresh reseed): **285 / 285 passed** across 19 spec files: every endpoint × owner / admin / manager / member / viewer against the matrix, API keys per role (revoked → 401), 401 unauthenticated, 422 validation, CSRF (cross-site cookie writes → 403), Globex-vs-Acme isolation (→ 404), real 404s for unknown and out-of-scope pages, sending through Mailpit, crawling the fixture site.
- `npm run test:ui` (desktop 1440, tablet 834, mobile Pixel 7): **184 passed, 2 skipped by design** (183 on the full run plus 1 flaky test, see open items, that passed on rerun); 13 spec files.
- Visual QA with Playwright MCP: every product screen at 1440 / 834 / 390, light and dark, as member, viewer and owner, plus the white-label host and platform admin. 316 screenshots in `.playwright-mcp/` (gitignored). Eight issues found and fixed.
- Production image: `docker build -f deploy/Dockerfile .` succeeds (includes `next build`); the container waits for Postgres and Redis, applies migrations, serves `/api/health` and `/api/health/ready` (ok / ok), the sign-in page and a real sign-in; the scheduler starts its three jobs. `docker compose -f deploy/docker-compose.prod.yml config --quiet` passes in both modes; `nginx -t` passes for `letsencrypt.conf` and `cloudflare.conf`; shellcheck clean on the deploy scripts; `sync-certs.sh` exercised with stubbed `psql` / `certbot`.

**Running locally:**

```bash
docker compose up -d          # Postgres :48432, Redis :48379, Mailpit :48025 / UI http://localhost:48026
npm install && npm run db:migrate && npm run db:seed
npm run dev                   # http://localhost:3410 ; white-label host http://acme.localhost:3410
npm run scheduler             # optional locally: runs the domains, crawl and sequences jobs
```

Demo accounts (password `demo-password-1234`): `owner@acme.test`, `admin@acme.test`, `manager@acme.test`, `member@acme.test`, `viewer@acme.test` (Acme Outbound, brand "Acme Prospecting" in emerald, host `acme.localhost:3410`), `owner@globex.test` (isolation checks), platform admin `admin@anhourleads.local`. Migrations up to `drizzle/0001_mailbox_smtp_outbound.sql`.

Local `.env` (gitignored) has `CRAWLER_ALLOW_PRIVATE_HOSTS=true` so the crawler tests can reach the fixture site on 127.0.0.1:48090. **Never set that in production.**

### What AnhourLeads has

- **Accounts and workspaces:** Better Auth email + password, sign-up creates a workspace (primary hosts only, `APP_ALLOW_SIGNUP`), invitations by email, password reset, workspace switcher, platform administrators.
- **Roles:** owner, admin, manager, member, viewer, enforced on every route and page, with guard rails (no granting above your rank, last owner protected, API keys can't manage members or keys).
- **People and companies:** Apollo-style search and filters, CRUD, bulk create / update / delete, stage and owner updates, CSV import (auto-mapping, dedupe, row report) and export (formula-injection safe), provenance per field.
- **Research and enrichment:** polite crawler (robots.txt, same-site, SSRF guard, limits) that finds company facts, emails, people, technologies, social links and hiring signals; apply findings with provenance and confidence rules; email verification (syntax, disposable, role, MX, optional SMTP probe, 7-day cache) and pattern-based email finding; `people/match` and `organizations/enrich`.
- **Lists:** static and dynamic lists of people or companies.
- **Sequences and sending:** multi-step sequences (auto email, manual email, call, task), enrollment with skip rules, review modes, mailbox SMTP with encrypted passwords, sending windows and daily limits, sender identification, one-click unsubscribe (`/u/<token>`, RFC 8058 headers), idempotent engine in the scheduler.
- **Pipeline:** tasks (mine / all, complete, skip), deals (board and table, totals per stage).
- **Compliance:** do-not-contact list (email and domain) honoured everywhere, privacy export and erasure with a minimal suppression record.
- **Workspace admin:** members, invitations, API keys (shown once, hashed), audit log with plain-language actions, overview KPIs.
- **White-label:** brand name, colour (12 named palette colours) and support email per workspace; custom hostnames verified by DNS TXT with the pending → verified → failing lifecycle; the brand follows the hostname; a workspace host never shows "AnhourLeads".
- **Production:** NGINX (Cloudflare or Let's Encrypt mode) → app → Postgres 17 + Redis 7, certbot syncing certificates for serving hostnames every 15 minutes, scheduler container, container entrypoint with migrations.

---

## Sessions

### 2026-10-10: platform foundation and the full first build

**Done:**

- Read the README goals and the iotkinect-portal conventions (ports, deploy stack, domain verification, docs) and adopted them. Scraped Apollo's API reference with Playwright into `docs/reference/apollo-api.md` (81 endpoints, paraphrased).
- Foundation: Docker services on uncommon ports, Drizzle schema and migrations, Better Auth per hostname, RBAC matrix, tenant + brand resolution, `route()` wrapper (actor, permission, CSRF, rate limit, errors, access log), branded auth pages, role-filtered sidebar, template demo routes hidden (404), Playwright harness, demo seed.
- Five parallel work packages, each with API, services, UI and tests: people and companies; research crawler, enrichment and verification; lists, sequences, mailboxes and sending; tasks, deals, do-not-contact, privacy, members, API keys, audit log and overview; white-label branding, custom hostnames, platform admin, and the production stack.
- Integration: full API and UI suites, real HTTP 404s for unknown or forbidden pages (list pages moved into `(index)` route groups so the `[id]` layouts run before the loading boundary), visual QA with fixes (Geist Mono wasn't applied anywhere because `--font-mono` was set on `:root` while the font variable lives on `body`; branded 404 page; theme boot script on 404s; brand-coloured pipeline chart; dead template sidebar buttons removed; preferences popover labels; plain audit labels; platform KPI size; back links; crawl meta line; sign-up 404 title).
- Docs: CLAUDE.md (working rules), BRANDING.md, architecture, roles, migration log, domains and SSL, deployment guide, this handoff.

**Verified:** see "Checks at last commit" above.

**Local data / env changes made while testing:** `.env` gained `SECRETS_ENCRYPTION_KEY`, `APP_ALLOW_SIGNUP=true` and `CRAWLER_ALLOW_PRIVATE_HOSTS=true`. The test suites reseed the database (`npm run db:seed -- --reset`), so local data is the demo seed plus test leftovers with unique names. A local image `anhourleads/app:local` was built for the smoke test.

---

## Open items and decisions

**Flaky / test infrastructure**

- `tests/ui/domains.spec.ts` "an owner adds, sees and removes a local hostname" can fail when desktop, tablet and mobile run it at the same time against Acme's limit of 3 hostnames; it passes on rerun. Fix: give each project its own hostname slot (or raise the limit in the test and restore it).
- Parallel Playwright runs share `.playwright-mcp/test-results`; concurrent runs delete each other's traces. Only matters when several people or agents run suites at once; use `--output=<dir>` per run.

**Product gaps (next phases)**

- Engagement: no inbox sync yet (replies are marked with `mark_replied`), no open/click tracking (toggles stored, off by default), plain-text emails only, no threading headers between steps, no A/B variants or branching.
- AI features from the README (account briefs, grounded personalization, reply classification) are not started.
- Data providers: no third-party enrichment providers or waterfall yet; enrichment is crawler + patterns + verification only.
- No Google Workspace / Microsoft 365 OAuth mailboxes (SMTP only); no CRM sync, webhooks, SSO, notifications, saved searches with alerts, or custom fields.
- Domains: certificate issuer, error and routing messages aren't stored (`workspace_domain` would need `cert_issuer`, `cert_error`, `routing_message`), so the UI shows generic sentences. Cloudflare for SaaS custom hostnames must be registered by hand. No notifications on hostname status changes (audited only).
- Tasks: the create dialog has no contact/company picker (API supports it). Workspace rename and delete are API-only. Deals board shows the 100 most recent deals. Removing a suppression doesn't restore a contact's previous stage.
- Lists: member counts are one query per list; batch later. Record pickers in forms load at most 500 companies.
- Crawler: same-site detection uses a short built-in list of multi-part suffixes, not the full public suffix list. `GET /organizations/enrich` can start a crawl (kept for Apollo parity); prefer the POST form, which has the CSRF check.
- Loading skeletons exist for every data route but weren't captured visually in dev.

**Decisions taken**

- API paths mirror Apollo's resource names; bodies are camelCase; pagination follows Apollo's envelope.
- One Next.js app for UI and API; business logic in `src/server/services`; Postgres as the only source of truth, Redis as cache/coordination only.
- Better Auth instance per hostname for white-label hosts.
- Admin-template demo screens kept but unreachable (404 via `src/proxy.ts`); the template's `dashboard/tasks` was removed because the product owns that route.
- `BRANDING.md` is upper-case to sit beside `CLAUDE.md` and `README.md`.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created with the first session's state, checks and open items |
