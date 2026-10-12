# Contributing to AnhourLeads

AnhourLeads, the open-source, self-hosted alternative to Apollo.io, is built and maintained by [Anhourtec](https://anhourtec.com). Thanks for helping improve it. This guide covers setup and the rules every change follows. The full working rules are in [CLAUDE.md](./CLAUDE.md); read it and [docs/handoff.md](./docs/handoff.md) before starting.

## Set up

```bash
git clone https://github.com/anhourtec/AnhourLeads.git
cd AnhourLeads
cp .env.example .env        # set BETTER_AUTH_SECRET (openssl rand -base64 48)
docker compose up -d        # Postgres :48432, Redis :48379, Mailpit :48025 (UI http://localhost:48026)
npm install
npm run db:migrate
npm run db:seed             # demo workspaces, one account per role (password demo-password-1234)
npm run dev                 # http://localhost:3410
```

Optional: `docker compose --profile crawler up -d --build` runs the crawler and scheduler.

## Project layout

```
src
├── app
│   ├── (main)/auth          # sign in, sign up, password reset
│   ├── (main)/dashboard     # every product screen; screen-only code in <screen>/_components
│   ├── (main)/onboarding    # first-run flow
│   ├── api                  # /api/v1 (Apollo-style resources), auth, health, domains
│   ├── privacy              # public removal-request page
│   └── t, u                 # email tracking and one-click unsubscribe
├── components               # shared components (ui/ is shadcn, don't edit)
├── lib                      # client-safe helpers, RBAC permissions, search filters
├── navigation               # sidebar and settings navigation
├── server                   # auth, db (drizzle), services, crawler, discovery, providers
└── styles                   # theme and brand tokens
extension/                   # browser extension (save one person from the current page)
scripts/                     # seed, scheduler, crawler worker, maintenance
tests/                       # Playwright: api/, ui/, isolated/
```

How the pieces fit: [docs/architecture.md](./docs/architecture.md). Who can do what: [docs/roles.md](./docs/roles.md). Design rules: [BRANDING.md](./BRANDING.md).

## Making a change

1. Branch from your current local branch: `git checkout -b <type>/<topic>`. Never commit straight to `main`.
2. Keep each feature workspace-scoped and role-gated: add the permission to `src/lib/rbac/permissions.ts`, enforce it in the route and the service, hide the UI with the same permission, and update `docs/roles.md`.
3. Test it:
   - `npm run test:api`: every endpoint for all five roles, 401, API keys, cross-workspace 404, 422 and CSRF.
   - `npm run test:ui`: every changed screen at desktop, tablet and mobile, light and dark.
   - `npm run typecheck` and `npx biome check <files>`.
4. Update the docs in the same change (`docs/handoff.md`, `docs/architecture.md`, `docs/migration.md` for schema changes).
5. Commit with conventional messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), one concern per commit, then open a pull request with screenshots for visual changes (include mobile and dark mode).

## Reporting issues

Open an issue at https://github.com/anhourtec/AnhourLeads/issues with steps to reproduce, what you expected and what happened, or contact Anhourtec at https://anhourtec.com.
