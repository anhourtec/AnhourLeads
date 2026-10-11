# Handoff

The running log of where AnhourLeads stands, so the next session can pick up without digging through history. **Update it at the end of every working session** (CLAUDE.md rule 10): newest session first, what changed, what's verified, what's open.

How things work: [architecture.md](./architecture.md). Who can do what: [roles.md](./roles.md). Design rules: [../BRANDING.md](../BRANDING.md). Hostnames and HTTPS: [domains-and-ssl.md](./domains-and-ssl.md). Deploying: [deployment-guide.md](./deployment-guide.md). Migrations: [migration.md](./migration.md). Apollo API model: [reference/apollo-api.md](./reference/apollo-api.md).

---

## Current state (2026-10-11, evening)

**Branch:** `feat/discovery-search`, cut from local `feat/apollo-parity` (nothing pushed). All work is committed in focused conventional commits with no AI attribution.

**Checks at last commit:**

- `npm run typecheck`: clean. `npx biome check` on every changed file: no errors.
- `npm run test:api` (fresh reseed, crawler containers running): **657 / 657 passed**. The real discovery index (573 companies, 442 people, 5,509 job postings) was identical before and after the reseed.
- UI, per viewport with `--workers=2`: `discovery-search`, `people-parity`, `companies-parity`, `platform-data`, `shell`, `contact-page`: desktop 39 passed and 1 failed, tablet 39 and 1, mobile 40 passed. The failure (platform Hosts tab search) was a real race, fixed; `platform-data` then passed 4 / 4 at every size. The full three-viewport UI suite has not been re-run end to end.
- `npm run scheduler` with every job (no `SCHEDULER_JOBS`) starts and runs all six jobs; it crashed on start before this session.

**Running locally:**

```bash
docker compose up -d          # Postgres :48432, Redis :48379, Mailpit :48025 / UI http://localhost:48026
npm install && npm run db:migrate && npm run db:seed
npm run dev                   # http://localhost:3410 ; white-label host http://acme.localhost:3410
docker compose --profile crawler up -d --build   # crawler worker + scheduler (discovery job only) as containers
docker compose --profile crawler logs -f crawler
```

The crawler and scheduler containers (`anhourleads-crawler`, `anhourleads-scheduler`, built from `deploy/Dockerfile.dev`, source bind-mounted so `restart` picks up changes) publish no ports and reach Postgres and Redis over the compose network. The dev scheduler runs only the discovery job (`DEV_SCHEDULER_JOBS`) so it never sends sequence email behind a test run; `npm run scheduler` on the host runs every job. Sources and the crawl are managed as the platform admin at `/dashboard/platform/data`.

Test logins are in the gitignored `credential.md` (demo password `demo-password-1234`). Migrations run up to `drizzle/0003_discovery_index.sql`. `npm run db:seed -- --reset` keeps the discovery index and crawl tables; add `--reset-index` to wipe them too. Run UI tests per viewport with `--workers=2` on a laptop.

Local `.env` (gitignored) has `CRAWLER_ALLOW_PRIVATE_HOSTS=true` so the dev server can reach crawler fixture sites on 127.0.0.1; the crawler container pins it to `false`. **Never set it in production.**

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

- **Apollo parity (2026-10-11):** the shell, navigation, typography (Inter, Hanken Grotesk, Roboto Mono), onboarding, home layouts, settings and every main screen follow the Apollo reference in `docs/reference/apollo-ui.md`; only the colours differ. Search with Total / Net new / Saved, facets, filters modal, natural-language box, saved searches and bulk actions; contact and company pages with notes and activity; custom fields, personas, import wizard; sequences with A/B variants, LinkedIn steps, schedules, rulesets and a policy-aware engine; emails and composer; tasks with a call session; deal pipelines; contact stages and triggers; a workflow engine and builder; data health and enrichment jobs; email setup and health with sending protection; analytics dashboards and reports; usage; an optional AI assistant (presets work without a provider).
- **Self-hosted data pipeline:** an installation-wide discovery index (companies, people, job postings, news) built from public sources only by a scalable crawler fleet, with platform administration and a public removal-request page; workspaces search it and save records with provenance.

---

## Sessions

### 2026-10-11 (evening): finding new people, and a real crawl

**Why:** Find people only searched the workspace's own records, and the discovery index held 3 fixture companies, so nobody new could be found.

**Done:**

- Find people / Find companies now have Apollo's three tabs: **Total** and **Net new** search the shared discovery index (rows already in the workspace show a Saved link), **Saved** is the workspace's own records with every existing search feature. The default tab is Total when the index has rows. Index rows have Save, Access email (saves, then finds and verifies the address), bulk save, save-then-add to list or sequence, and person and company sheets (people, job postings, news, sources). Filters the index can't apply are disabled with a "Saved records only" note. Index size filters now combine with "or", like workspace search. No new routes or permissions.
- Filled the index from real public sources: 50 SaaS domains added by hand, Wikidata (500 rows, head count required), 40 verified public job boards (Greenhouse, Ashby), company sitemaps. Result: **573 companies, 442 people at 78 companies (226 leaders), 5,509 job postings, 1,581 news items**. Most large SaaS sites publish no crawlable team page, so people cluster where one exists; published addresses are rare (6).
- Crawler fixes against the real web: Wikidata query rewritten (the subclass walk timed out at 60 s), large pages truncated instead of skipped (2 MB cap), job-board JSON up to 16 MB, domain moves followed as new seeds, boards for uncrawled companies create the company, false people dropped (product headings, review authors, initial-only surnames), multilingual leadership titles, translated page copies skipped, company names and countries normalised.
- Workers without an explicit host list never claim reserved test hosts (`localhost`, `*.test`, `*.example`…), so a running crawler can't disturb the fixture specs.
- Seed `--reset` keeps the index; `--reset-index` wipes it.
- Platform data Hosts and Crawl queue tables ignore out-of-date responses (the unfiltered first load could overwrite a search once the real crawl made it slow).
- Fixed the full scheduler crashing on start in plain Node (`createContext is not a function`): `src/server/auth/context.ts`, `services/records.ts` and `services/engage-context.ts` now load `next/navigation` on first use.

**Verified:** see "Checks at last commit" above. Playwright MCP screenshots of the new tabs as owner and viewer (desktop, 390 px, dark) in `.playwright-mcp/`.

### 2026-10-11: Apollo parity and the self-hosted data pipeline

**Done:**

- Walked Apollo's app in a signed-in test account with Playwright (home, search, records, lists, import, sequences, emails, tasks, deals, workflows, analytics, enrichment, settings, ⌘K, assistant) and wrote `docs/reference/apollo-ui.md` (page-by-page reference + build plan). Credits used on the test account: one email reveal (it earned more from onboarding tasks; balance 104 at the end). Test artefacts left in that Apollo account: a list "P", a sequence "T" with one unsaved step, a deal pipeline "Pipeline 1", and the anti-spam agreement accepted.
- Shared foundations first: migration 0002 (parity tables and columns), parity permissions, the record event hub (`recordEvent`), job placeholders; migration 0003 (discovery index).
- Six parallel packages (shell; search and records; engage; deals, stages and workflows; data, deliverability, analytics and AI; self-hosted data pipeline). A usage limit stopped every agent once; all resumed and finished.
- Integration: unhid `/dashboard/analytics` in `src/proxy.ts`; wired the discovery job and `npm run crawler`; installation-wide opt-outs now count as suppression in the sending engine; `recordEvent` keeps `last_activity_at` current; `.env.example` gained AI and crawler settings; sidebar Data enrichment gate aligned with its page; deleted the three superseded UI specs (`people`, `companies`, `lists`); fixed six UI failures; Playwright default timeouts raised to 90 s per test and 15 s per assertion for the shared dev server.
- Docs: roles (new permissions and rules), migrations 0002 and 0003, architecture (parity layer, event hub, workflow engine, sending protection, discovery index), `docs/data-pipeline.md`, deployment guide (crawler service), BRANDING.md and CLAUDE.md (fonts, "only colours differ" rule).

**Verified:** see "Checks at last commit" above.

**Local data / env changes:** test suites reseed the database; `.env` unchanged except as listed in the 2026-10-10 entry (AI and crawler settings default to off when absent).


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

- The empty-index state on Find people / Find companies (admin link vs "ask your administrator") has no automated test; emptying the index would wipe the dev crawl. Cover it with a fixture-only database or a feature flag.
- The full three-viewport UI suite should be re-run end to end (per viewport, `--workers=2`) to confirm the fixes together; only the affected specs were re-run.
- React's dev-only `Performance.measure … negative time stamp` message appears intermittently; tests filter it. Radix `Checkbox`/`Switch` hidden inputs can log hydration mismatches in dev; screens that hit it render those controls after hydration or use display-only icons.

**Product gaps (next phases)**

- Not built because they need outside services: phone dialer, meeting booking, call recording, website-visitor identification, form builder, CRM sync, Google / Microsoft mailbox OAuth, inbox sync (replies are marked manually), a reply classifier. Their screens are honest "not available yet" states.
- Data pipeline: settings and removal requests are stored in the Better Auth `verification` table as a stop-gap (proposed `platform_setting` and `index_removal_request` tables in `docs/data-pipeline.md`); people are keyed by company + full name; seed runs are synchronous; Retry-After isn't honoured; DNS-TXT opt-out success path is unverified. People coverage is thin: JavaScript-rendered team pages aren't read (no headless browser), and emails are pattern guesses verified on access.
- Usage is stored as `usage.lookup` audit rows (a `usage_event` table would be cleaner); notification preferences have no storage (read-only page); saved-search alerts are stored but not sent; stars on saved searches and dashboards are workspace-wide, not per user; `workflow` description and re-enrollment live in `schedule.settings`.

- AI: the assistant, account briefs and grounded drafts work with a configured provider (`AI_PROVIDER`) and fall back to templates; reply classification is not built.
- Data providers: no third-party enrichment providers or waterfall yet; enrichment is crawler + patterns + verification only.
- No SSO.
- Domains: certificate issuer, error and routing messages aren't stored (`workspace_domain` would need `cert_issuer`, `cert_error`, `routing_message`), so the UI shows generic sentences. Cloudflare for SaaS custom hostnames must be registered by hand. No notifications on hostname status changes (audited only).
- Deals board shows one pipeline at a time and the 100 most recent deals. Removing a suppression doesn't restore a contact's previous stage.
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
| 2026-10-11 | Nishchayjeet Singh (Nish) | Discovery search tabs, real crawl, crawler containers, scheduler fix |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Apollo parity and self-hosted data pipeline session; current state, checks and open items updated |
