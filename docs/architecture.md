# Architecture

How AnhourLeads fits together, frontend and backend. Who can do what is in [roles.md](./roles.md), white-label hostnames and HTTPS in [domains-and-ssl.md](./domains-and-ssl.md), deployment in [deployment-guide.md](./deployment-guide.md), the design system in [../BRANDING.md](../BRANDING.md), and the Apollo API model we mirror in [reference/apollo-api.md](./reference/apollo-api.md).

---

## System overview

```
                 ┌──────────────────────── Docker host (deploy/docker-compose.prod.yml) ────────────────────────┐
 Browser /       │                                                                                              │
 API client ──▶ NGINX :80/:443 ──▶ app (Next.js 16, :3410) ──▶ Postgres 17   (all data, sessions, audit)      │
 (any host)      │   ▲  TLS per hostname       │                 ▶ Redis 7      (tenant/brand cache, rate limits,│
                 │   │                         │                                 job locks, verification cache) │
                 │ certbot ──reads verified────┘                 ▶ SMTP         (mailboxes' own servers;       │
                 │ (Let's Encrypt, 15 min)  hostnames from Postgres               Mailpit locally)             │
                 │                                                                                              │
                 │ scheduler (same image) ── runs src/server/jobs/*: domains re-check, crawl queue, sequences   │
                 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **One Next.js app** serves the UI (React Server Components + client components) and the API (`src/app/api/**` route handlers). There is no separate backend service: business logic lives in `src/server/**`, imported by both pages and route handlers.
- **Postgres** is the single source of truth (Drizzle ORM, migrations in `drizzle/`). **Redis** is an optimisation and a coordinator (caches, rate limits, locks); every Redis failure is tolerated.
- **The scheduler** is the same image running `scripts/scheduler.ts`, which runs each job in `src/server/jobs/registry.ts` on its interval. No host crontab.
- **NGINX** terminates TLS for the installation's own hostnames and for each workspace's verified custom hostname; **certbot** issues those certificates from the list of serving hostnames it reads from Postgres.

## Repository layout

```
src/
├── app/
│   ├── (main)/
│   │   ├── auth/(app)/          sign-in, sign-up, forgot/reset password, accept invite (branded per host)
│   │   ├── auth/_components/    the auth forms (client components)
│   │   └── dashboard/           the product (one folder per screen, co-located _components/)
│   │       ├── layout.tsx       app shell: getAppContext() → sidebar, workspace switcher, header
│   │       ├── overview/ people/ companies/ lists/ research/
│   │       ├── sequences/ mailboxes/ tasks/ deals/ account/ platform/
│   │       ├── settings/{members,do-not-contact,api-keys,branding,domains,audit-log}/
│   │       └── _components/     shared dashboard pieces: sidebar/, header/, records/, engage/, pipeline/
│   ├── api/
│   │   ├── auth/[...all]/       Better Auth, served by the instance for the request's hostname
│   │   ├── health/ health/ready liveness and readiness
│   │   ├── domains/tls-ask/     public: "does this hostname get a certificate?"
│   │   └── v1/**                the product API (Apollo-style paths, see below)
│   ├── u/[token]/               public one-click unsubscribe (GET page + RFC 8058 POST)
│   ├── layout.tsx               root: fonts, theme boot, <html data-brand> from getRequestBrand()
│   └── globals.css              tokens; imports src/styles/brand.css (white-label colours)
├── components/ui/               local shadcn components (never edited)
├── config/                      app-config.ts, brand.ts (default brand + palette)
├── lib/
│   ├── rbac/permissions.ts      roles, permissions, matrix, can() — shared by server, UI and tests
│   ├── auth-client.ts           Better Auth browser client (no baseURL → works on any host)
│   └── records-vocabulary.ts, pipeline-constants.ts, api-fetch.ts, format-display.ts
├── navigation/sidebar/          sidebar items with the permission each needs; navFor(role)
├── proxy.ts                     optimistic redirects (signed out → /auth/login), hides template routes
├── server/                      everything server-only (see "Backend")
└── styles/brand.css             data-brand → --primary/--ring mapping per brand colour
drizzle/                         SQL migrations + snapshots (logged in docs/migration.md)
scripts/                         migrate, seed, scheduler, domains-recheck, docker-entrypoint
deploy/                          Dockerfile, production compose, nginx/, certbot/, build.sh
tests/
├── support/                     session helpers (sign in per role, API keys), matrix, global setup, fixture server
├── api/                         RBAC + CRUD harness, one spec per domain
├── ui/                          screen specs, run at desktop / tablet / mobile
└── fixtures/site/               static website the crawler tests crawl
```

The admin template this project started from left demo screens under `src/app/(main)/dashboard/*` and `(external)/`. They are kept for reference but return 404 (`TEMPLATE_ROUTES` in `src/proxy.ts`).

## Request flow

### Pages

1. `src/proxy.ts` (Next 16's middleware): template routes → 404; `/` → overview or sign-in; `/dashboard/**` without a session cookie → `/auth/login?next=…`. This is only an optimistic check.
2. The root layout calls `getRequestBrand()` to set `<html data-brand>` and the page title template.
3. The dashboard layout calls `getAppContext()` (`src/server/auth/context.ts`): resolve the tenant from the hostname (unknown host → not found), load the session from that host's Better Auth instance (none → redirect to sign-in), the user's workspaces and role, and the brand.
4. Pages are Server Components. They build an actor from the context and call services directly. Gated pages and `[id]` routes check permission or existence in a `layout.tsx`, before the `loading.tsx` boundary, so a forbidden or unknown page answers with a real HTTP 404.
5. Client components do mutations with `fetch` to `/api/v1/**` (same origin, cookie auth), then `router.refresh()`.

### API

Every authenticated handler is wrapped in `route()` (`src/server/http/route.ts`):

```
request ─▶ resolveActor()          session cookie (per-host Better Auth) or X-Api-Key / Bearer al_…
        ─▶ CSRF                    cookie-authenticated writes must come from the same origin (else 403)
        ─▶ requirePermission()     role must hold the route's permission (else 403)
        ─▶ rate limit              Redis fixed window: 600/min reads, 120/min writes, 30/min sensitive (fails open)
        ─▶ handler                 zod-parse input → service(actor, input) → JSON
        ─▶ errors                  HttpError → its status; ZodError → 422 with field details; else 500 + request id
        ─▶ access log              one JSON line: request id, method, path, status, duration, user/key, workspace
```

Public handlers (Better Auth, health, `tls-ask`, workspace registration, unsubscribe) don't use `route()`; they use `errorResponse()` for consistent errors.

**Actor** (`src/server/auth/actor.ts`): `{ kind: "user" | "apiKey", userId, apiKeyId, organizationId, role, isPlatformAdmin, tenant }`. On a workspace hostname the workspace is fixed to that host's; on the installation's hosts it's the session's active workspace. API keys carry their own role and are bound to their workspace.

**Services** (`src/server/services/*`) take the actor, check anything beyond the route permission (ownership, guard rails, combined permissions) and filter **every** query by `actor.organizationId`. Ids from another workspace are reported as 404, never 403. Every write is audited (`audit()` → `audit_log`, never with secrets).

### API surface (`/api/v1`)

Paths follow Apollo's resource names so the model is familiar (`docs/reference/apollo-api.md`). JSON bodies are camelCase; lists paginate with `page` and `per_page` (max 100) and return `pagination: { page, per_page, total_entries, total_pages }`.

| Area | Endpoints |
| --- | --- |
| People | `contacts` (CRUD, `search`, `bulk_create`, `bulk_update`, `bulk_delete`, `update_stages`, `update_owners`, `import`, `export`, `[id]/provenance`, `[id]/opportunities`), `contact_stages`, `mixed_people/search` |
| Companies | `accounts` (same set), `account_stages`, `mixed_companies/search` |
| Enrichment | `people/match`, `people/bulk_match`, `organizations/enrich`, `organizations/bulk_enrich`, `email_verifications` |
| Research | `crawl_jobs` (create, list, get, `[id]/apply`) |
| Lists | `labels` (CRUD, `[id]/members`, `[id]/candidates`, `add_entity_ids`, `remove_entity_ids`) |
| Sequences | `emailer_campaigns` (CRUD, `search`, `[id]/steps`, `approve`, `abort`, `archive`, `add_contact_ids`, `remove_or_stop_contact_ids`, `resume_contact_ids`, `mark_replied`, `run_now`, `enrollments`, `stats`, `candidates`), `emailer_messages` (`search`, `[id]/approve`, `[id]/send_now`) |
| Mailboxes | `email_accounts` (CRUD, `[id]/test`) |
| Pipeline | `tasks` (CRUD, `search`, `bulk_create`, `[id]/complete`, `[id]/skip`), `opportunities` (CRUD, `search`), `opportunity_stages` |
| Compliance | `suppressions` (list, add, `bulk`, delete, `check`), `privacy/erase`, `privacy/export` |
| Workspace | `users` (`search`, `api_profile`, `invite`, `invitations`, `[userId]`), `api_keys`, `audit_logs`, `workspace`, `workspace/branding`, `domains` (+ `verify`), `overview`, `workspaces/register` |
| Shell | `search` (⌘K: people, companies, settings pages), `notifications` (+ `read`), `activities`, `onboarding` (GET / POST start / PATCH) |
| Platform | `platform/workspaces` (platform administrators only) |

## Backend modules (`src/server/`)

| Module | Responsibility |
| --- | --- |
| `env.ts` | Validated environment (zod), parsed lazily so builds don't need secrets |
| `db/schema.ts`, `db/index.ts` | Drizzle schema (all tables) and the pooled client (one `pg` pool per process, on `globalThis`) |
| `redis.ts` | ioredis client, `cacheGet/Set/Del` that swallow failures |
| `log.ts` | JSON logger with key-based redaction; server code never uses `console.*` |
| `auth/auth.ts` | Better Auth: one instance per hostname (`getAuth(tenant)`), email + password, organization plugin (workspaces, invitations), admin plugin (platform role), hooks that restrict sign-in on a workspace host to its members and pin the active workspace |
| `auth/access.ts` | Access control for Better Auth's own organization endpoints |
| `auth/actor.ts`, `auth/context.ts`, `auth/context-actor.ts` | Actor resolution for API and pages, tenant + brand for pages |
| `http/route.ts`, `errors.ts`, `rate-limit.ts` | The API wrapper, typed HTTP errors, Redis rate limiter |
| `tenancy/host.ts`, `tenancy/brand.ts` | Hostname → tenant (primary host or verified workspace domain, cached 60 s), workspace brand (cached 5 min) |
| `crypto/secrets.ts` | AES-256-GCM for stored secrets (mailbox SMTP passwords) |
| `email/mailer.ts` | Transactional mail (invites, password resets) |
| `email/verify*.ts`, `patterns.ts`, `disposable-domains.ts` | Email verification (syntax, disposable, role, MX, optional SMTP probe; 7-day cache) and pattern detection/generation |
| `crawler/*` | Polite public-web crawler: robots.txt, same-site, SSRF guard checked at connect time and per redirect, size/time limits, extraction (contacts, people, tech, social, hiring) |
| `domains/*` | Hostname validation, DNS TXT verification, routing and certificate checks, lifecycle (pending → verified → failing → off) |
| `services/*` | Business logic per domain (contacts, companies, records, enrichment, research, lists, sequences, mailboxes, sending, tasks, deals, suppressions, privacy, members, api-keys, audit-log, workspace, overview, branding, domains, platform) |
| `jobs/*` | Scheduled jobs: `domains` (re-checks), `crawl` (queued and stale crawl jobs), `sequences` (sending engine, every 60 s) |

## Data model

All product tables carry `organization_id` (the workspace) and every query filters by it.

```
organization (workspace, brand, hostname_limit) ─┬─ member ── user ── session / account (Better Auth)
                                                 ├─ invitation
                                                 ├─ workspace_domain (custom hostnames)
                                                 ├─ api_key (hash only) · audit_log · suppression (do-not-contact)
                                                 ├─ company ──< contact ──< field_provenance (company|contact fields)
                                                 ├─ list ──< list_member (contact or company ids)
                                                 ├─ mailbox (SMTP, encrypted password, limits, window)
                                                 ├─ sequence ──< sequence_step
                                                 │      └──< enrollment (contact) ──< outbound_message
                                                 ├─ task (assignee, contact/company) · deal (stage, amount)
                                                 └─ crawl_job ──< crawl_page
```

- **Provenance:** every enriched, imported or edited field writes a `field_provenance` row (source, source URL, confidence, retrieved at). Values are only overwritten by equal or higher confidence; values typed by a person count as full confidence.
- **Suppression** is checked at enrollment and again at send time; adding an entry moves matching contacts to `do_not_contact` and stops their enrollments.
- Migrations and their rollback levels: [migration.md](./migration.md).

## Multi-tenancy and white-label

- **Tenant resolution** (`resolveTenant(host)`): a primary host (`APP_PRIMARY_HOSTS`) → the installation; a `workspace_domain` that is verified (or failing within the 7-day grace) → that workspace; anything else → 404 for pages, auth and the API. `X-Forwarded-Host` is trusted only with `APP_TRUST_PROXY=true` (behind NGINX, which overwrites it).
- **Auth per hostname:** each hostname gets its own Better Auth instance (base URL and trusted origin = that host), so cookies, CSRF and links stay on the host the person used. On a workspace host, only members can sign in (outsiders get the same "Invalid email or password"), sign-up is off and the workspace is fixed.
- **Brand:** name, colour and support email from the host's workspace, or on primary hosts from the signed-in user's active workspace, else the AnhourLeads default. The root layout writes `data-brand`; `src/styles/brand.css` maps it to `--primary` and friends. Emails use the workspace's name as sender. A workspace host never shows "AnhourLeads".
- **Hostname lifecycle and HTTPS:** see [domains-and-ssl.md](./domains-and-ssl.md).

## Engagement engine

`src/server/services/sending.ts`, run by the `sequences` job every 60 s (and by `run_now`):

1. Per active sequence, under a Redis lock: take due enrollments (`next_run_at <= now`) inside the mailbox's sending window and time zone.
2. Render the current step's merge fields; a missing value blocks the message instead of sending blanks.
3. Re-check suppression, email status and contact stage at send time; blocked messages record a reason and pause the enrollment.
4. Respect the mailbox's daily limit; hold messages for review per the sequence's review mode.
5. Send through the mailbox's SMTP server with sender identification (display name + postal address), an unsubscribe link (`/u/<HMAC token>`) and `List-Unsubscribe` / `List-Unsubscribe-Post` headers.
6. Non-email steps create tasks; then advance the step and schedule the next one. A "message exists for this enrollment and step" check makes runs idempotent.

## Frontend

- **Shell:** `dashboard/layout.tsx` (Server Component) → `AppSidebar` (client, filters `sidebarItems` with `navFor(role)`) + header (search, workspace switcher, layout controls, theme switcher). Mobile: the sidebar becomes a sheet.
- **Screens** follow one pattern: `page.tsx` (server: actor → services → props), `layout.tsx` (permission/existence gate when needed), `loading.tsx` (skeleton mirroring the layout), `error.tsx`, `_components/` (client components for tables, filters, dialogs). Role-gated actions use `can(role, permission)` with the role passed from the server.
- **Shared dashboard components:** `_components/records/` (data table, filters, pagination, search box, CSV import, export, delete confirm, provenance line, status pills), `_components/engage/` (tone pills), `_components/pipeline/` (page header, confirm dialog, URL-synced filters).
- **State:** URL search params for filters and pagination (shareable, server-rendered); local component state for dialogs; `zustand` only for the template's layout preferences.
- **Design system:** [BRANDING.md](../BRANDING.md). Geist / Geist Mono, semantic tokens, `data-brand` colours, light and dark.

## Background jobs and operations

| Job | Interval | What |
| --- | --- | --- |
| `domains` | 5 min | Pending hostnames every run until verified or expired (7 days); live ones at most hourly; failing → off after grace; Redis lock per hostname |
| `crawl` | 5 min | Picks up queued crawl jobs and ones stuck in running (new jobs also start right after the request via `after()`) |
| `sequences` | 60 s | The sending engine above |
| `workflows` | 60 s | Scheduled workflow triggers and resuming waiting runs |
| `enrichment` | 120 s | Queued enrichment jobs, automation, stale sending-domain DNS checks |
| `discovery` | 5 min | Seed sources, re-queueing stale pages, lease recovery, retention |

`npm run scheduler` runs them all (`SCHEDULER_JOBS` limits which); it touches a heartbeat file for the container healthcheck. Health: `GET /api/health` (liveness, no dependencies) and `GET /api/health/ready` (Postgres, Redis; 503 when down).

## Security

- Sessions: Better Auth, HTTP-only cookies prefixed `anhour`, per hostname. Passwords ≥ 10 characters.
- CSRF: same-origin check on every cookie-authenticated write; Better Auth checks its own trusted origin.
- Authorization: permission per route + workspace scope per query; 404 for out-of-scope ids; guard rails on roles (see roles.md).
- API keys: shown once, stored as SHA-256, bound to a workspace and role, revocable, `last_used_at` tracked.
- Secrets: mailbox passwords encrypted (AES-256-GCM), write-only in API and UI; the logger redacts password/secret/token/key/cookie fields.
- Crawler SSRF guard: public addresses only (checked at connect time and per redirect), robots.txt obeyed, no logins, no forms, no JavaScript.
- Rate limits on every API route; sensitive operations (enrichment, crawling, exports, key creation, imports) at 30/min.

## Testing

| Harness | Command | What |
| --- | --- | --- |
| API (RBAC + CRUD) | `npm run test:api` | Every endpoint × owner/admin/manager/member/viewer against the matrix, API keys, 401, 422, CSRF, cross-workspace isolation (Globex vs Acme), domain behaviour (sending via Mailpit, crawler against `tests/fixtures/site`) |
| UI | `npm run test:ui` | Every screen at 1440 / 834 / mobile, per role, light and dark, no horizontal overflow, no console errors |
| UI, isolated | `npm run test:ui:isolated` | Installation states the shared dev database can't take on without losing data (empty discovery index). Second dev server on :43410 (`.next-isolated`), database `anhourleads_isolated` (created, migrated, seeded with `--reset --reset-index` every run), Redis db 2 |
| Visual QA | Playwright MCP | Screens reviewed by hand-driven browser sessions; output in `.playwright-mcp/` |

Both use `playwright.config.ts`; the global setup reseeds the database once per run (`TEST_SKIP_SEED=true` skips it).

---

## Apollo-parity layer (2026-10-11)

The screens follow the Apollo reference in [reference/apollo-ui.md](./reference/apollo-ui.md); only the colours differ. What was added and where it lives:

| Area | Server | API (`/api/v1`) | Screens (`/dashboard`) |
| --- | --- | --- | --- |
| Shell, search, notifications, onboarding | `services/{global-search,notifications,onboarding,home}.ts` | `search`, `notifications`, `activities`, `onboarding` | sidebar groups, top bar (⌘K, bell, avatar menu), `home`, `onboarding-hub`, `/onboarding`, settings shell `settings/*` |
| Search & records | `services/search-filters.ts` (one filter model for search, saved searches, dynamic lists; Total / Net new / Saved counts; facets), `lib/search/nl-parser.ts` | `mixed_people/*`, `mixed_companies/*`, `saved_searches`, `notes`, `custom_fields`, `personas`, `contacts/import/*`, `accounts/import/*` | `people`, `companies`, `saved/*`, `lists`, `import`, contact and company pages |
| Engage | `services/{sending,sending-guards,engage-rules,schedules,templates,emails,tracking,consents}.ts` | `emailer_campaigns/*`, `emailer_messages/*`, `emailer_schedules`, `email_templates`, `snippets`, `consents/anti-spam`, `tasks/*` | `sequences`, `emails`, `tasks`, `settings/{schedules,templates}` |
| Deals, stages, workflows | `services/{pipelines,deals,record-stages,stage-triggers,workflows,workflow-engine,workflow-runner}.ts` | `pipelines`, `opportunities/*`, `record_stages`, `stage_triggers`, `workflows/*`, `workflow_templates` | `deals`, `workflows`, `settings/{pipelines,contact-stages}` |
| Data, deliverability, analytics, AI | `services/{enrichment-jobs,data-health,sending-domains,sending-policy,deliverability,analytics,dashboards,usage,ai}.ts` | `enrichment_jobs`, `data_health`, `duplicates`, `sending_domains`, `sending_policy`, `deliverability/*`, `analytics/query`, `dashboards`, `usage`, `ai/*` | `enrichment`, `analytics`, `assistant`, `settings/{deliverability,usage,ai-context}` |
| Discovery index & crawler fleet | `server/discovery/*`, `crawler/fleet/*`, `services/discovery.ts` | `index/*`, `platform/{seed_sources,crawler,optouts}` | `platform/data`, public `/privacy/removal` |

**Event hub.** `services/events.ts` → `recordEvent()` is the single entry point for record events (email sent/opened/replied/bounced/unsubscribed, stage changes, list and sequence membership, tasks, calls, notes, deals). It writes the `activity` timeline row, updates `last_activity_at`, then runs the handlers: contact-stage triggers (`stage-triggers.ts`), workflow enrollment (`workflow-engine.ts`) and sequence ruleset reactions (`engage-rules.ts`). Handlers never throw into the caller.

**Workflow engine.** `workflow-engine.ts` only enrolls (one active run per workflow and record, advisory lock); execution lives in `workflow-runner.ts`, which registers itself when loaded (routes, pages, the scheduler job), avoiding an import cycle through the event hub. Runs act with the owner's permissions, re-checked every pass; delays set `resume_at` and the `workflows` job resumes them; webhooks are https-only, SSRF-guarded and signed (`x-anhour-signature`).

**Sending protection.** The sending engine reads the workspace `sending_policy` (restrict unverified / catch-all, require signature, gradual ramp-up, bounce guard, workspace daily limit) and holds messages as `blocked` with a `Policy: …` reason; installation-wide opt-outs (`index_optout`) count as suppression in every workspace.

**Discovery index.** An installation-wide index of companies, people, job postings and news built only from public sources (Wikidata CC0, domain lists, sitemaps, public job-board APIs) by the crawler fleet (`npm run crawler`, `--scale crawler=N`; `FOR UPDATE SKIP LOCKED` frontier, one request per host at a time, robots.txt, deny-list for walled gardens). Workspaces search it and copy rows in with provenance; private workspace data never flows into it. Details: [data-pipeline.md](./data-pipeline.md).

**Find people / Find companies over the index.** `/dashboard/people` and `/dashboard/companies` load through `loadFindPage()` (`services/search-page.ts`) with Apollo's three tabs in `?segment=`: **Total** = every index row matching the filters (`searchIndexPeople` / `searchIndexCompanies`), each flagged when the workspace already holds it (same matching as `netNewForWorkspace`: companies by domain, people by published address or by name at the same company domain); **Net new** = index rows the workspace doesn't hold; **Saved** = the workspace's own records through `loadSearchPage()` with no segment (all workspace filters, facets, columns, bulk actions). Without `?segment=` the page opens on Total when the index has rows, else Saved. Tab counts: Total and Net new from `indexSegmentCounts()` (one query, also used by `POST /api/v1/index/{people,companies}/search` with `includeCounts`), Saved from the workspace count under the same filters. The shared filter state maps onto the index input in `lib/search/index-filters.ts` (titles, seniority, department, name, location / exclude, country, company location, company names / exclude, domains, size ranges / min / max / unknown, industry / exclude, keywords / exclude, technologies, founded); workspace-only filters (owner, stage, lists, sequences, engagement, email status, persona, source, imports, dates, custom fields) are shown disabled on Total / Net new and listed in a "Not applied to the shared database" note, never silently dropped. Index rows hide emails until "Access email" (`POST /api/v1/index/people/access_email`: saves the person, then runs people/match with verification; lookups are logged as usage, no credits). Row and bulk actions call `index/people/save` / `index/companies/save` (`contact:create` / `company:create`); "Save and add to list / sequence" saves first, then opens the usual dialogs with the workspace ids. Index people open a side sheet from the row data; index companies open a sheet backed by `GET /api/v1/index/companies/[id]` (people, job postings, news, sources). An empty index shows how it is built, with a link to Platform → Data → Seed sources for platform admins. Saved searches remember the tab they were saved on.

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created: system overview, layout, request flow, API, backend modules, data model, tenancy, engine, frontend, jobs, security, testing |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Apollo-parity layer, event hub, workflow engine, sending protection, discovery index |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Find people / Find companies: Total and Net new search the discovery index, Saved shows workspace records |
