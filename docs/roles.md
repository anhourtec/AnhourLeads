# Roles and permissions

Who can do what in AnhourLeads. The source of truth is `src/lib/rbac/permissions.ts`; this page must match it (CLAUDE.md rule 10). The API harness (`tests/api/`) checks every endpoint for every role against the same matrix.

## Levels

```
Installation (platform administrators)
  └── Workspaces (brands, teams or clients)
        └── Members: owner · admin · manager · member · viewer
```

- **Workspace roles** apply inside one workspace. A person can belong to several workspaces with a different role in each, and switches between them from the header (on the installation's own hostnames). On a workspace's own hostname, only that workspace's members can sign in, and the workspace is fixed.
- **Platform administrators** (`user.role = "admin"`, created by the seed from `SEED_PLATFORM_ADMIN_*`) operate the installation: they see all workspaces and set each workspace's custom hostname limit (Platform screen). They have no access to a workspace's data unless they are also a member of it.
- **API keys** belong to a workspace and carry a role, chosen at creation and never higher than the creator's. A key acts with exactly that role's permissions. Keys can't manage members or create other keys, and are never platform administrators.

## Roles

| Role | In one sentence |
| --- | --- |
| **Owner** | Full control, including deleting the workspace and making or demoting other owners. |
| **Administrator** | Manages people, API keys, branding and domains, plus everything a manager can do. |
| **Manager** | Runs the team's data and outreach: deletes records, manages mailboxes, the do-not-contact list and reads the audit log. |
| **Member** | Day-to-day prospecting: adds and edits records, imports and exports, enriches, crawls, builds lists and runs sequences. |
| **Viewer** | Read-only access to data, lists, sequences, tasks and deals, plus search. Can't export, enrich or change anything. |

## Permission matrix

✓ = allowed. Out-of-scope ids (another workspace's records) always answer **404**, whatever the role.

| Permission | Owner | Admin | Manager | Member | Viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| `contact:read`, `company:read`, `list:read`, `sequence:read`, `mailbox:read`, `task:read`, `deal:read`, `crawler:read`, `suppression:read`, `member:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `search:run` (people and company search) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contact:create`, `contact:update`, `contact:import`, `contact:export` | ✓ | ✓ | ✓ | ✓ | |
| `company:create`, `company:update`, `company:import`, `company:export` | ✓ | ✓ | ✓ | ✓ | |
| `enrich:run` (enrichment, email finding and verification) | ✓ | ✓ | ✓ | ✓ | |
| `list:create`, `list:update` | ✓ | ✓ | ✓ | ✓ | |
| `sequence:create`, `sequence:update`, `sequence:launch` (activate, enroll, approve messages) | ✓ | ✓ | ✓ | ✓ | |
| `task:create`, `task:update`, `task:delete` | ✓ | ✓ | ✓ | ✓ | |
| `deal:create`, `deal:update` | ✓ | ✓ | ✓ | ✓ | |
| `crawler:run` | ✓ | ✓ | ✓ | ✓ | |
| `suppression:create` (add to do-not-contact) | ✓ | ✓ | ✓ | ✓ | |
| `contact:delete`, `company:delete`, `list:delete`, `sequence:delete`, `deal:delete` | ✓ | ✓ | ✓ | | |
| `mailbox:create`, `mailbox:update`, `mailbox:delete` | ✓ | ✓ | ✓ | | |
| `suppression:delete` (remove from do-not-contact) | ✓ | ✓ | ✓ | | |
| `audit:read` | ✓ | ✓ | ✓ | | |
| `domain:read` (see hostnames and DNS records) | ✓ | ✓ | ✓ | | |
| `member:invite`, `member:update`, `member:remove` | ✓ | ✓ | | | |
| `apikey:read`, `apikey:create`, `apikey:revoke` | ✓ | ✓ | | | |
| `workspace:update`, `branding:update`, `domain:manage` | ✓ | ✓ | | | |
| `workspace:delete` | ✓ | | | | |
| `analytics:read` (dashboards, reports) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `savedsearch:create`, `note:create` | ✓ | ✓ | ✓ | ✓ | |
| `template:create`, `template:update` (email templates and snippets; `template:read` for everyone) | ✓ | ✓ | ✓ | ✓ | |
| `workflow:create`, `workflow:update`, `workflow:launch` (`workflow:read` for everyone) | ✓ | ✓ | ✓ | ✓ | |
| `ai:use` (AI assistant, AI-assisted drafts) | ✓ | ✓ | ✓ | ✓ | |
| `note:delete` (any note; authors can always delete their own), `template:delete`, `workflow:delete` | ✓ | ✓ | ✓ | | |
| `schedule:manage` (sending schedules), `persona:manage`, `dashboard:manage` | ✓ | ✓ | ✓ | | |
| `deliverability:read` (email setup and health) | ✓ | ✓ | ✓ | | |
| `pipeline:manage`, `stage:manage` (deal pipelines, contact stages and triggers) | ✓ | ✓ | | | |
| `customfield:manage`, `deliverability:manage` (sending protection, sending domains), `aicontext:manage` | ✓ | ✓ | | | |

Adding to the do-not-contact list is open to members on purpose: honouring an opt-out should never wait for a manager. Removing an entry is a manager decision.

## Guard rails

- Nobody can grant a role above their own, or change or remove someone ranked above them.
- Only an owner can make someone an owner or demote an owner. The last owner can't be demoted or removed.
- API keys can't be created with a role above the creator's. Keys can't create other keys, manage members or delete the workspace. You can only revoke keys at or below your own role.
- Deleting the workspace needs the owner role and the workspace's exact name as confirmation.
- Cookie-authenticated writes must come from the same origin (CSRF); cross-site writes get 403.
- Sign-in on a workspace hostname is refused for non-members with the same "Invalid email or password" message as a wrong password, so membership doesn't leak.
- Suppressed (do-not-contact) emails and domains are never enrolled or emailed, whatever the role.

## Actions that need two permissions

| Action | Needs |
| --- | --- |
| Apply crawl findings to a company | `company:update`, plus `contact:create` to add found people and `company:create` to create a new company |
| Verify a contact's email and save the result | `enrich:run` + `contact:update` |
| Enrich an organization when that starts a new crawl | `enrich:run` + `crawler:run` |
| Erase everything held about an email (privacy request) | `contact:delete` + `suppression:create` |

## Other rules added with the Apollo-parity screens

- **Workflows run as their owner.** Launching makes the launcher the owner; every run re-checks that the owner still holds `workflow:launch` and each action's own permission, and fails with a plain message otherwise.
- **Anti-spam acknowledgement.** People who went through onboarding must accept it before creating their first sequence (409 until they do).
- **Turning off bounce protection** on a sequence needs manager or above.
- **Private templates and snippets** are visible only to their owner (404 for everyone else).
- **AI chats** are private to their author; another person's chat id answers 404.
- **Usage:** everyone sees their own usage; the per-person breakdown needs `audit:read`.
- **Discovery index:** searching it needs `search:run`; saving people or companies into the workspace needs `contact:create` / `company:create`; "Access email" also needs `enrich:run`. On Find people / Find companies the Total and Net new tabs (the index) are open to every role with `search:run`; Save buttons show with `contact:create` / `company:create`, "Access email" with `enrich:run` plus `contact:create`, so viewers see index rows read-only.

## Platform administrators

Only users with the platform role can open the Platform screen and `/api/v1/platform/**` (all workspaces, member counts, hostnames, and each workspace's custom-hostname limit, 0 to 50). Everyone else, including every API key, gets 403 from the API and a 404 page. Platform administrators also run the data pipeline (Platform → Data: seed sources, crawl queue, hosts, opt-outs and removal requests, retention). The public removal page `/privacy/removal` needs no account.

## Navigation

The sidebar (`src/navigation/sidebar/sidebar-items.ts`, `navFor`) shows only screens the role can open; each item carries the permission it needs. The settings sidebar, the settings overview and the command palette's settings results do the same from `src/navigation/settings/settings-items.ts` (`settingsFor`). Pages check the same permission on the server and render not-found when it's missing, so a hidden link can't be opened by URL.

Personal endpoints: `/api/v1/notifications` (and `/read`) and `/api/v1/onboarding` act only on the signed-in person's own rows, for every role; someone else's notification id answers 404, and API keys get 403 (there is no person behind a key). `/api/v1/activities` is open to every member of the workspace. `/api/v1/search` needs `search:run`, and only returns people with `contact:read`, companies with `company:read` and settings pages the role may open. Viewers skip onboarding.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Created: five workspace roles, platform administrators, API keys, matrix and guard rails |
| 2026-10-10 | Nishchayjeet Singh (Nish) | Combined-permission actions, key revoke and workspace delete rails, platform screen |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Apollo-parity permissions, workflow, consent and AI rules, data pipeline administration |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Settings navigation filtering, personal endpoints (notifications, onboarding), search scope |
