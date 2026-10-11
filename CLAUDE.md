@AGENTS.md

# AnhourLeads

Open-source, self-hosted alternative to Apollo.io: find and enrich B2B companies and people, verify emails, build lists, run outreach sequences from your own mailboxes, track tasks and deals. Multi-workspace, role-gated and fully white-label (each workspace can serve its own brand on its own verified hostname). See README.md for the product goals.

Read before changing anything:

- `docs/handoff.md`: where things stand, last check results, open items. Updated every session.
- `docs/architecture.md`: how the frontend and backend fit together.
- `docs/roles.md`: who can do what. Mirrors `src/lib/rbac/permissions.ts`.
- `BRANDING.md`: fonts, colours, type scale, components. Every screen follows it.
- `docs/domains-and-ssl.md`: white-label hostnames, verification, NGINX + certbot.
- `docs/reference/apollo-api.md`: the Apollo API inventory our `/api/v1` mirrors.

## Stack

Next.js 16 App Router (`middleware` is `src/proxy.ts`; read `node_modules/next/dist/docs/` before using an API) · React 19 · TypeScript strict · Tailwind v4 + shadcn/ui (radix-nova) · Better Auth (email + password, organization + admin plugins) · Postgres 17 via drizzle-orm · Redis 7 via ioredis · Playwright (API + UI harness) · Biome.

## Running it

```bash
cp .env.example .env        # set BETTER_AUTH_SECRET (openssl rand -base64 48)
docker compose up -d        # Postgres :48432, Redis :48379, Mailpit :48025 (UI http://localhost:48026)
npm install
npm run db:migrate
npm run db:seed             # demo workspaces and one account per role (password demo-password-1234)
npm run dev                 # http://localhost:3410 ; white-label host: http://acme.localhost:3410
```

**Test logins live in `credential.md`** (repo root, gitignored, never commit it): every seeded account, its role and workspace, and the local Postgres / Redis / Mailpit logins. Read it before signing in to test anything. Whenever you add, remove or change a test account, a seeded role, a password or a local service login (`scripts/seed.ts`, `.env`, `docker-compose.yml`), update `credential.md` in the same change.

Demo accounts: `owner@acme.test`, `admin@acme.test`, `manager@acme.test`, `member@acme.test`, `viewer@acme.test` (workspace Acme Outbound, host `acme.localhost:3410`), `owner@globex.test` (second workspace, for isolation checks), platform admin from `SEED_PLATFORM_ADMIN_*`.

## Ports: never use common ones

| Service | Host port | Never use |
| --- | --- | --- |
| Next.js dev / start | **3410** | 3000, 3001, 8080 |
| Postgres | **48432** | 5432, 5433 |
| Redis | **48379** | 6379 |
| Mailpit SMTP / UI | **48025** / **48026** | 1025, 8025 |

New local services get a 4xxxx port bound to 127.0.0.1, overridable via `.env`, and a row here. Production (`deploy/docker-compose.prod.yml`) publishes only 80 and 443 (NGINX).

## Working rules

1. **No AI attribution, anywhere.** Never mention Claude, AI or any assistant in commit messages, PR descriptions or code comments. No `Co-Authored-By` trailer for an assistant, no "Generated with" lines. Write as a human author would.
2. **Always work on a branch created from the current local branch:** `git checkout -b <type>/<topic>`. Never `git checkout -b <branch> origin/main` (that links the branch to main as its upstream). Never commit directly to `main`. Never push unless asked.
3. **Conventional, focused commits.** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`. One concern per commit (infra, schema, auth, RBAC, a feature, docs), never one mega-commit.
4. **Run multiple agents in parallel.** Split work into independent pieces that touch disjoint files (one domain per agent: API + UI + tests for that domain), launch them in one message, then integrate. Shared files (`schema.ts`, `sidebar-items.ts`, `permissions.ts`) are changed by the coordinator, not by parallel agents.
5. **Every feature is workspace-scoped and role-gated.** Add permissions to `src/lib/rbac/permissions.ts`, enforce them in the route (`route(handler, { permission })`) and in the service (scope every query by `actor.organizationId`), hide the UI with the same permission (`navFor`, `can()`), and update `docs/roles.md`. Out-of-scope ids return **404**, never 403, so other workspaces' ids don't leak.
6. **Test every API change with every role.** The Playwright API harness (`tests/api/`, `npm run test:api`) checks each endpoint for all five roles (owner, admin, manager, member, viewer) against the matrix (`tests/support/matrix.ts` → `expected(role, permission)`), plus: unauthenticated → 401, API key auth, cross-workspace isolation (Globex can't read or change Acme's ids → 404), validation errors → 422, CSRF (cross-site cookie writes → 403). The full harness must pass before committing.
7. **Test every UI change at every screen size.** `npm run test:ui` runs `tests/ui/` at desktop (1440), tablet (834) and mobile (Pixel 7). Use agents with Playwright (the test runner and the Playwright MCP) to open each changed screen as the affected roles, in light and dark, check the console for errors, check there is no horizontal overflow, and fix anything broken before calling it done.
8. **Playwright output goes in `.playwright-mcp/`** (gitignored): screenshots, snapshots, traces, reports. Pass filenames like `.playwright-mcp/<nn>-<what>.png`. Never write screenshots elsewhere or commit them.
9. **Follow BRANDING.md on every screen.** Inter for UI text, Hanken Grotesk for headings, Roboto Mono for column headers, numbers, ids, emails and code; only colours differ from the reference app (docs/reference/apollo-ui.md). Semantic tokens only (`bg-primary`, `text-muted-foreground`…), never hex/rgb/oklch in components. Workspaces change name, brand colour and support email only, never fonts or layout. Buttons are `size="sm"` with a leading Lucide icon (`data-icon="inline-start"`), except sign-in/sign-up submits (`size="lg"`). Sentence case everywhere.
10. **Keep docs current in the same change.** `docs/handoff.md` (end of every session: current state, checks, what shipped, open items), `docs/architecture.md` (flows, boundaries, data model), `docs/roles.md` (permissions), `BRANDING.md` (design rules), `docs/migration.md` (every migration with its rollback level).
11. **Lint and types on every changed file.** `npx biome check <files>` and `npm run typecheck`. No `any`, no `@ts-ignore`, no blanket `biome-ignore`.
12. **Verify before declaring done.** A change is done when the API harness, the UI harness and a Playwright check of the real flow pass. Report failures as they are; never claim a check you didn't run.
13. **Don't modify `src/components/ui/` or `src/components/calendar/`** (AGENTS.md). Style where components are used.

## Project rules

- **Route handlers** (`src/app/api/**`) parse input with zod and call services (`src/server/services/*`). Authenticated handlers always go through `route()` (`src/server/http/route.ts`): actor resolution (session cookie or `X-Api-Key`), permission, CSRF for cookie writes, rate limit, error mapping, access log. Public handlers (auth, health, register) use `errorResponse()` for errors.
- **Services take the `Actor`** and filter every query by `actor.organizationId`. Never trust a client-sent workspace id.
- **API shape** mirrors Apollo's resource model (`docs/reference/apollo-api.md`): `/api/v1/contacts`, `/accounts`, `/mixed_people/search`, `/mixed_companies/search`, `/people/match`, `/organizations/enrich`, `/labels`, `/emailer_campaigns`, `/email_accounts`, `/tasks`, `/opportunities`, `/users`. JSON bodies are camelCase; pagination is Apollo-style (`page`, `per_page` → `pagination: { page, per_page, total_entries, total_pages }`).
- **White-label:** the brand (name, colour, support email) comes from the request hostname (`workspace_domain`, verified only) or, on the installation's own hosts, from the signed-in user's active workspace. A workspace host never shows "AnhourLeads". Unknown hostnames get 404 everywhere. Auth instances are per hostname (`getAuth(tenant)`); restart `npm run dev` after editing `src/server/auth/auth.ts`.
- **Compliance by default:** suppressed emails/domains (do-not-contact) are never enrolled or emailed; every send carries unsubscribe and sender identification; the crawler respects robots.txt, fetches public pages only and never logs in anywhere.
- **Secrets:** never logged (the logger redacts), never returned after creation (API keys are shown once, stored as SHA-256), never put in audit metadata.
- **Logging:** server code uses `log` from `src/server/log.ts`, never `console.*` (scripts may print).
- **Migrations:** change `src/server/db/schema.ts`, then `npm run db:generate -- --name <what>` and `npm run db:migrate`. Never edit an applied migration. Log it in `docs/migration.md`.
- **Template leftovers:** the admin template's demo screens are kept for reference but return 404 (`src/proxy.ts`). Don't build on them and don't delete them without asking.

---

## Document history

Anyone who updates this file adds a line here: date (UTC), who, what changed.

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created: working rules, ports, stack, project rules |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Test logins kept in gitignored `credential.md`; keep it current |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Rule 9: fonts follow BRANDING.md (Inter, Hanken Grotesk, Roboto Mono) |
