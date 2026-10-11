# Data pipeline: the discovery index and the crawler fleet

AnhourLeads can build its own **installation-wide discovery index** of companies, people, job postings and news, from **public sources only**, with crawlers you run yourself. Workspaces search it, see what they already hold ("net new"), and copy the records they want into their own workspace, with provenance on every field.

The index belongs to the installation, not to a workspace. It is never filled from workspaces' private records, and nothing saved in a workspace flows back into it. See README "What AnhourLeads is not": this is not a data broker and not a scraper for walled gardens.

Code: `src/server/discovery/*` (pure helpers, seeds, index writes, opt-outs, removal requests, admin), `src/server/crawler/fleet/*` (frontier, page processing, worker loop), `src/server/services/discovery.ts` (what workspaces use), `src/server/jobs/discovery.ts`, `scripts/crawler-worker.ts`.

---

## Architecture

```
 platform admin ─▶ seed sources (seed_source) ──┐                         workspaces (search:run …)
   Wikidata SPARQL (CC0), domain lists,         │                              │
   manual domains, sitemaps, job boards         ▼                              ▼
                                       crawl_frontier (URLs) ◀── links of   /api/v1/index/**  ──▶ save ──▶ company / contact
                                        crawl_host (robots,      interest      (services/discovery.ts)      (+ field_provenance,
                                        delay, errors, blocked)      ▲               ▲                       source "discovery_index")
                                               │ claim (SKIP LOCKED) │               │ read
                       ┌───────────────────────┼─────────────────────┤               │
                       ▼                       ▼                     │      index_company ─< index_person
            crawler worker 1 … N  ── robots.txt ─ guarded fetch ─ extract ─▶ index_job_posting, index_news
            (scripts/crawler-worker.ts, CRAWLER_CONCURRENCY lanes each)      (sources = provenance per company)
                       │                                                            ▲
                       └── heartbeat: /tmp/crawler-heartbeat + Redis key            │ delete + never again
                                                                                index_optout ◀── /privacy/removal
 scheduler ─▶ discovery job (5 min): due seed sources, re-queue due pages,          (email link / DNS TXT)
             recover dead leases, retention                                     ◀── platform admin
```

### One URL, start to finish

1. **Claim** (`frontier.claimNext`): in one transaction, take the least recently used host that isn't blocked and whose `next_allowed_at` has passed and that has a due queued URL (`FOR UPDATE OF crawl_host SKIP LOCKED`), then its best URL by priority (`FOR UPDATE SKIP LOCKED`). Both get a 5-minute lease (`next_allowed_at`, `next_attempt_at`), so no other worker on any machine can touch that host meanwhile.
2. **Checks**: deny-list, opt-out of the company's domain, robots.txt (cached in `crawl_host.robots_txt` for a day; fetching it is a request, so the per-host pause applies before the page).
3. **Fetch** with the existing guarded fetch (`src/server/crawler/fetch.ts`): http/https only, SSRF guard at connect time and on every redirect, no cookies, no credentials, no forms, no JavaScript, 1 MB / 10 s caps, content-type allow-list (HTML, XML for feeds and sitemaps, JSON for job-board APIs). A redirect to another host on the same site (acme.com → www.acme.com) becomes its own URL with its own robots.txt and politeness.
4. **Extract** (reusing `src/server/crawler/extract.ts` and `technologies.ts`): Organization JSON-LD, name, description, phone, founding year, head count, location, technologies, published emails, social profile links (stored as plain URLs, never fetched), people from JSON-LD `Person`, microdata or team-card markup, RSS/Atom feeds, job-board links.
5. **Write the index**: upsert `index_company` by registrable domain (fills empty fields; Wikidata wins for industry, country, head count and founding year), add a provenance entry to `sources`; upsert `index_person` per (company, full name) with seniority and department inferred from the title (same vocabulary as workspace search); people the page listed before but not any more get `gone_at` (a likely job change) and lose it when seen again; detect the company's email pattern from published addresses (`src/server/email/patterns.ts`); `index_job_posting` from job-board APIs; `index_news` from feeds.
6. **Follow**: same-site links of interest only (about, team, contact, careers), depth ≤ 2, at most `CRAWLER_MAX_PAGES_PER_HOST` queued per host per day; advertised feeds; job boards linked from the site.
7. **Settle** (`frontier.settle`): success schedules the re-crawl for the page kind; 429 / 5xx / timeouts back off exponentially (1 min, 2 min, 4 min … ≤ 1 day) and count against the host, which is **blocked automatically** after `CRAWLER_HOST_ERROR_LIMIT` consecutive errors; 404s fail without retry; skips record their reason.

### Page kinds, priorities and re-crawl intervals

| Kind | Priority | Re-crawl (default, days) | What it gives |
| --- | --: | --: | --- |
| homepage | 100 | 30 | Company facts, technologies, links |
| team | 90 | 14 | People (and job changes) |
| about | 85 | 30 | Facts, sometimes people |
| contact, careers | 80 | 30, 7 | Phones, emails; job-board links |
| ats (job-board API) | 75 | 1 | Job postings (hiring signal, departments, locations) |
| rss (feed) | 70 | 1 | News |
| sitemap | 60 | 30 | More pages of interest |

Intervals and retention are editable under Platform → Data pipeline → Settings.

## Sources and licences

| Source | Seed kind | What is read | Licence / basis |
| --- | --- | --- | --- |
| Wikidata | `wikidata` | SPARQL at `https://query.wikidata.org/sparql`: items that are instances of business / company / enterprise (or a subclass) with an official website (P856), optional country (P17), industry (P452), employees (P1128), inception (P571), headquarters (P159). Filters: country and industry item ids; LIMIT/OFFSET paging, one request every 2 s, our user agent | CC0 1.0 (recorded on each company's provenance) |
| Domain lists | `domain_list` | Homepages from a CSV or text list an operator uploads (e.g. a public top-sites list they downloaded) | Whatever the list's own licence allows; only the domains are used |
| Manual | `manual` | Domains an operator types | n/a |
| Sitemaps | `sitemap` | `/sitemap.xml` of indexed companies (robots.txt applies), for about / team / careers pages | Public pages |
| Job boards | `ats_boards` | Public JSON APIs of boards a company links from its own site: Greenhouse `boards-api.greenhouse.io/v1/boards/<token>/jobs`, Lever `api.lever.co/v0/postings/<token>?mode=json`, Ashby `api.ashbyhq.com/posting-api/job-board/<token>`, Workable `apply.workable.com/api/v1/widget/accounts/<token>`. The board pages themselves are never fetched | Documented public APIs |
| Company websites | (crawl) | About, team, contact and careers pages, feeds, robots.txt | Public pages, robots.txt obeyed |

The SPARQL endpoint and job-board API bases are configurable per seed source (`config.endpoint`, `config.endpoints`), which is how the tests point them at local fixtures.

## Boundaries (enforced in code and tested)

| Rule | Where | Test |
| --- | --- | --- |
| Public pages only; no logins, forms, cookies or JavaScript | `safeFetch` (GET only, no cookie jar, no script execution) | research specs, `crawler-worker.spec.ts` |
| robots.txt for our product token, else `*`; Crawl-delay honoured; unreachable robots.txt = retry later, never "allow" | `fleet/process.ts` `robotsFor`, `crawler/robots.ts` | disallowed `/contact` and a disallow-all site are `skipped: robots` and never requested |
| ≥ 2 s between requests to a host (floor), Crawl-delay raises it (capped at 60 s), one request in flight per host across the fleet | `classify.hostDelayMs`, `frontier.claimNext` / `settle` | request timestamps ≥ 2.5 s apart for a `Crawl-delay: 2.5` site; `crawl_host.crawl_delay_ms = 2500` |
| Exponential back-off on 429 / 5xx / network; auto-block after repeated errors; manual block / unblock | `frontier.settle`, `admin.setHostBlocked` | units (back-off), block/unblock spec |
| SSRF guard: public addresses only (connect time and every redirect); private only with `CRAWLER_ALLOW_PRIVATE_HOSTS=true` (tests; production compose pins `false`) | `crawler/fetch.ts` `guardedLookup` | research-units (IP classifier) |
| Never fetch social networks, walled gardens, job and review sites or data vendors (LinkedIn, Facebook, Instagram, X/Twitter, TikTok, Glassdoor, Indeed, ZoomInfo, Apollo, RocketReach, Crunchbase…); links to a company's own public profiles are stored, never followed | `discovery/denylist.ts`, checked on enqueue, claim and every redirect | seeds with LinkedIn / Facebook / Crunchbase are `skipped: denylist`; no social URL is ever queued from a page |
| Never copy workspaces' private records into the index | the index is written only by `fleet/*` and `seeds.ts`; save is one-way (index → workspace) | `discovery.spec.ts` (saving doesn't add or change index rows) |
| Opt-outs honoured everywhere | `isOptedOut()`; SQL guards in search and save; enqueue and processing skip opted-out domains | opted-out domain is `skipped: opted_out`, never requested; opted-out person never comes back after a re-crawl; excluded from search and save |
| Identify ourselves | `CRAWLER_USER_AGENT` + contact URL (`CRAWLER_CONTACT_URL`, default `<primary host>/privacy/removal`) | user agent asserted on every fixture request |

## Opt-outs and removal requests

- `index_optout` holds domains (covering subdomains), email addresses and people (`"full name|domain"`). Adding one deletes what the index holds (a domain deletes its company with its people, jobs and news) and marks its queued URLs `skipped: opted_out`. Opted-out rows never return: enqueue, processing, search and save all check.
- **Public page** `/privacy/removal` (no sign-in, primary hostnames only, rate limited by client IP and at most 3 requests per address per hour):
  - *Email*: a confirmation link is mailed to that address; the opt-out is added only when the link's page is confirmed with a click (opening the link alone changes nothing, so mail scanners can't confirm).
  - *Domain*: add the DNS TXT record `anhour-optout=<token>` to the domain and press "Check DNS now", or give an address at that domain and follow the mailed link.
  - Pending requests expire after 7 days; platform administrators see them under Opt-outs.
- Platform administrators add or remove opt-outs by hand (Platform → Data pipeline → Opt-outs, or the API below).
- **Sending engine**: call `isOptedOut({ email, domain, fullName })` from `src/server/services/discovery.ts` before sending; it answers true for an opted-out address, domain (or parent domain) or person. Workspace suppression lists are not modified by index opt-outs.

## Scaling

- Every worker runs `CRAWLER_CONCURRENCY` lanes (default 4). Run more replicas (`docker compose up -d --scale crawler=N`) or more machines against the same Postgres and Redis; claiming is safe across all of them.
- Throughput is bounded by politeness, not CPU: at 2 s per host, one host gives at most 30 pages a minute; a fleet scales with the number of distinct hosts in the queue.
- Workers report every 15 s to Redis (`anhour:crawler:worker:<host>:<pid>`, 90 s expiry) and to `/tmp/crawler-heartbeat` (container healthcheck).
- `POST /api/v1/platform/crawler/run_once` runs the same code synchronously for up to 50 URLs (tests and debugging).

## Retention

- People not seen on their source page for `retentionDays` (default 180) are deleted by the `discovery` job.
- People dropped from their page get `gone_at` at once; search hides them unless `includeGone: true`.
- Job postings count as "hiring" while seen in the last 30 days.

## How the product uses the index (API for the People / Companies screens)

All endpoints use `route()`: session cookie or API key, CSRF for cookie writes, rate limits. Pagination is Apollo-style (`page`, `per_page` ≤ 100 → `pagination`).

### `POST /api/v1/index/people/search` (search:run)

```jsonc
// request: any subset; arrays accept a string or string[]
{
  "q": "forecast",                         // name, title or company name
  "titles": ["chief", "head of"], "titlesExclude": ["intern"],
  "seniority": ["c_suite", "vp"],           // SENIORITIES (src/lib/records-vocabulary.ts)
  "department": ["Sales"],                 // DEPARTMENTS labels (src/lib/search/filters.ts)
  "country": ["Canada"], "city": ["Toronto"], "location": ["Ontario"],
  "industry": ["software"], "industryExclude": ["staffing"],
  "keywords": ["logistics"], "technologies": ["HubSpot"],
  "employeeRanges": ["21-50"], "employeesMin": 10, "employeesMax": 500,
  "foundedMin": 2010, "foundedMax": 2020,
  "hiring": true,                          // job postings seen in the last 30 days
  "hasEmail": true,                        // the company published this person's address
  "domains": ["acme.com"], "domainsExclude": ["example.com"],
  "includeGone": false,
  "segment": "net_new",                    // total | net_new | saved (for this workspace)
  "sortBy": "relevance",                   // relevance | name | title | company | lastSeenAt
  "sortAscending": true,
  "includeCounts": true,
  "page": 1, "per_page": 25
}
// response
{
  "people": [{
    "id": "…", "name": "Maya Chen", "firstName": "Maya", "lastName": "Chen",
    "title": "Chief Executive Officer", "seniority": "c_suite", "department": "C-Suite",
    "emailAvailable": true,                // address revealed by "Access email", never in search
    "sourceUrl": "https://orbit.example/team", "firstSeenAt": "…", "lastSeenAt": "…", "goneAt": null,
    "company": { "id": "…", "name": "Orbit", "domain": "orbit.example", "websiteUrl": "…", "industry": "…",
                 "employeeCount": 42, "employeeRange": "21-50", "country": "Canada", "city": "Toronto" },
    "savedContactId": null, "netNew": true
  }],
  "pagination": { "page": 1, "per_page": 25, "total_entries": 1, "total_pages": 1 },
  "counts": { "total": 1, "net_new": 1, "saved": 0 }     // only with includeCounts
}
```

### `POST /api/v1/index/companies/search` (search:run)

Same company filters (no title / seniority / department / includeGone; `hasEmail` = has people with a published address; `q` = name or domain); `sortBy`: `relevance` (most people first) | `name` | `employeeCount` | `foundedYear` | `lastCrawledAt`. Response `companies[]` with the company fields above plus `description`, `keywords`, `technologies`, `foundedYear`, `region`, `phone`, `linkedinUrl`, `twitterUrl`, `emailPattern`, `peopleCount`, `jobCount`, `hiring`, `lastCrawledAt`, `firstSeenAt`, `savedCompanyId`, `netNew`.

### `GET /api/v1/index/companies/[id]` (search:run)

`{ company, people[], jobs[], news[], provenance[] }`: people include gone ones (`goneAt`), jobs `{title, department, location, url, source, postedAt, lastSeenAt}`, news `{title, url, source, publishedAt}`, provenance = the company's `sources` (`{source, url, retrievedAt, fields, license?}`). Opted-out or unknown ids → 404.

### Save to workspace

| Endpoint | Permission | Body | Result |
| --- | --- | --- | --- |
| `POST /api/v1/index/companies/save` | company:create | `{ "ids": ["…"] }` (1–100) | `{ saved: [{indexId, id}], existing: [{indexId, id}], skipped: [{indexId, reason}] }`; dedupe by domain; `source = "discovery_index"`; one `field_provenance` row per field with the URL it came from |
| `POST /api/v1/index/people/save` | contact:create | `{ "ids": ["…"] }` | Same shape. Creates the company too when the role has company:create; dedupe by address, or name at the same company; the published address is copied; skip reasons `not_found`, `opted_out`, `suppressed` (workspace do-not-contact), `gone` |
| `POST /api/v1/index/people/access_email` | enrich:run (+ contact:create when not yet saved) | `{ "id": "…" }` | Saves the person if needed, then runs the workspace's own people match and verification: `{ contactId, created, person, credits }` (`person` as from `/people/match`) |

`netNewForWorkspace(organizationId, { companyIds, personIds })` in the service returns index id → workspace record id (or null) for screens that render index rows themselves.

### Platform administration (platform administrators only; API keys never; others 403)

| Endpoint | What |
| --- | --- |
| `GET/POST /api/v1/platform/seed_sources`, `GET/PATCH /api/v1/platform/seed_sources/[id]` | List / create / configure / enable sources. Body `{kind, name, enabled?, config?, text?}`; `text` = CSV or lines of domains for `domain_list` / `manual` |
| `POST /api/v1/platform/seed_sources/[id]/run` | Run now (`{refresh: true}` re-queues already crawled list domains); returns the source with `stats` |
| `GET /api/v1/platform/crawler/stats` | Frontier by status, queued by kind, hosts (total, blocked, backing off), 60 one-minute throughput buckets, index counts, live workers |
| `GET /api/v1/platform/crawler/frontier?status=&kind=&host=&q=` | Crawl queue |
| `GET /api/v1/platform/crawler/hosts?state=all|blocked|backoff&q=` | Host politeness state |
| `POST /api/v1/platform/crawler/hosts/[host]/block` (`{reason?}`), `…/unblock` | Manual control |
| `POST /api/v1/platform/crawler/run_once` | `{max ≤ 50, hosts?, budgetMs?}`: process URLs synchronously |
| `GET/PATCH /api/v1/platform/crawler/settings` | `{retentionDays, recrawlDays: {kind: days}}` |
| `GET/POST /api/v1/platform/optouts`, `DELETE /api/v1/platform/optouts/[id]`, `GET /api/v1/platform/optouts/requests` | Opt-outs (`{kind: domain|email|person, value, domain?, reason?}`) and pending removal requests |

Screen: **Platform → Data pipeline** (`/dashboard/platform/data`): Overview, Seed sources, Crawl queue, Hosts, Opt-outs, Settings.

## Gaps and follow-ups

- Settings and pending removal requests are stored in the generic `verification` table (identifiers `discovery:settings` and `index-removal:<token>`) because there is no platform settings or removal-request table yet. Proposed: `platform_setting (key text pk, value jsonb, updated_at)` and `index_removal_request (token pk, kind, value, reason, sent_to, secret_hash, created_at, expires_at, confirmed_at)`.
- `crawl_frontier` has no `company_domain` column; job-board URLs find their company through `discovered_from`. A column would make that explicit.
- People are keyed by (company, full name): two different people with the same name at one company merge.
- No `Retry-After` handling yet (back-off is exponential regardless).
- Seed runs are synchronous inside the API request or the scheduler job; very large Wikidata runs (tens of thousands of rows) should move to a background run with progress.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-11 | Nishchayjeet Singh (Nish) | Created: architecture, sources and licences, boundaries, politeness, opt-outs, scaling, retention, index API |
