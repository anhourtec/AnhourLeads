# Apollo.io REST API — Endpoint Inventory

> **Summarized, paraphrased inventory for interoperability design.**
> Retrieved 2026-10-10 from <https://docs.apollo.io/reference/apollo-api> (and each endpoint page linked from its sidebar).
> Descriptions are written in our own words; consult the official docs for authoritative wording and current behavior.
> AnhourLeads is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by Apollo.io**.
> "Apollo" and related names are trademarks of their respective owner and are used here only to describe compatibility.

## Conventions observed across the API

| Topic | Observation |
| --- | --- |
| Base URL | `https://api.apollo.io/api/v1` (all paths below are relative to it). |
| Auth (users) | API key in the `x-api-key` header. Keys can be scoped to individual endpoints; a **master key** unlocks every endpoint. Some endpoints (calls, email stats) accept only a master key. |
| Auth (partners) | OAuth 2.0 bearer token; each endpoint lists an OAuth scope (shown in the per-endpoint sections). |
| Acting user | API-key requests act as the workspace's oldest active admin; OAuth requests act as the granting user. Check with `GET /users/api_profile`. Some create/update endpoints take `owner_id`/`user_id` to set ownership explicitly. |
| Health check | `GET /auth/health` validates a key (mentioned in setup docs, not a sidebar endpoint). |
| Parameter style | Many POST endpoints historically take filters as query-string params with Rails-style arrays (`person_titles[]=...`) and ranges (`revenue_range[min]`, `revenue_range[max]`). Newer endpoints take JSON bodies. |
| Pagination | `page` + `per_page` (max 100 per page); responses carry a `pagination` object (`page`, `per_page`, `total_entries`, `total_pages`). Search endpoints cap display at 50,000 records (500 pages × 100). Notes use `skip`/`limit` instead. |
| Search response envelope | Common keys: `breadcrumbs`, `partial_results_only`, `has_join`, `disable_eu_prospecting`, `partial_results_limit`, `pagination`, `num_fetch_result`, plus the result array. |
| Errors | Legacy root fields `error`, `error_code`, `message`, plus a newer `error_details` object `{code: "DOMAIN.CATEGORY.REASON", message, suggestions[], context{}}`. Legacy fields are announced for removal on 2027-02-16. Common codes: 401, 403, 422, 429. |
| Rate limits | Per **team**, per **endpoint**, enforced in minute/hour/day fixed windows. Defaults by plan (Free / Basic / Professional / Organization): 50/200/200/200 per minute, 200/400/400/600 per hour, 600/2,000/2,000/6,000 per day. Enrichment endpoints: 1,000/min with no hourly/daily cap on paid plans (Free: 50/min, 20/min for bulk). Database search endpoints (people, organization, news): 200/min, 6,000/hr, 50,000/day on paid plans. Analytics report: 5/hour. Export conversations: 1/min and 20/hr on Free. |
| Rate-limit headers | `x-rate-limit-minute`, `x-rate-limit-hourly`, `x-rate-limit-24-hour`, `x-minute-usage`, `x-hourly-usage`, `x-24-hour-usage`, `x-*-requests-left`, `retry-after` on 429. |
| Credits | Enrichment and database search consume credits; CRM record management is free (0 credits). Credit notes per endpoint below. |
| Async jobs | Several bulk operations return an `entity_progress_job`; phone/waterfall enrichment returns via webhook or polling (`request_id`). |
| Custom fields | Records accept a `typed_custom_fields` object keyed by custom field ID. |
| Naming | "Sequences" are `emailer_campaigns`; "Deals" are `opportunities`; "Lists" are `labels`; "Organizations" are Apollo-database companies, "Accounts" are saved companies; "People" are database persons, "Contacts" are saved persons. |

## Summary table

81 operations across 7 sidebar sections (plus one non-endpoint reference page for analytics metrics).

| # | Section | Method | Path | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Search & Enrich — People | POST | `/mixed_people/api_search` | Find net-new prospects in the Apollo database (no emails/phones returned). |
| 2 | Search & Enrich — People | GET | `/people/{id}` | Fetch the full profile of one database person by ID. |
| 3 | Search & Enrich — People | POST | `/people/match` | Enrich/match a single person from identifying details. |
| 4 | Search & Enrich — People | POST | `/people/bulk_match` | Enrich up to 10 people in one call. |
| 5 | Search & Enrich — Companies | POST | `/mixed_companies/search` | Find companies in the Apollo database using firmographic filters. |
| 6 | Search & Enrich — Companies | GET | `/organizations/{id}` | Fetch the full profile of one database organization. |
| 7 | Search & Enrich — Companies | GET | `/organizations/enrich` | Enrich a single company by domain / LinkedIn / website / name. |
| 8 | Search & Enrich — Companies | POST | `/organizations/bulk_enrich` | Enrich up to 10 companies in one call. |
| 9 | Search & Enrich — Companies | GET | `/organizations/{organization_id}/job_postings` | List a company's active job postings. |
| 10 | Search & Enrich — Companies | POST | `/news_articles/search` | Search news articles tied to specific companies. |
| 11 | Manage Records — Accounts | POST | `/accounts/search` | Search the team's saved accounts. |
| 12 | Manage Records — Accounts | GET | `/accounts/{id}` | View one saved account. |
| 13 | Manage Records — Accounts | POST | `/accounts` | Create one account (no dedupe). |
| 14 | Manage Records — Accounts | POST | `/accounts/bulk_create` | Create up to 100 accounts with optional dedupe. |
| 15 | Manage Records — Accounts | PATCH | `/accounts/{account_id}` | Update one account. |
| 16 | Manage Records — Accounts | POST | `/accounts/bulk_update` | Update up to 1,000 accounts (shared or per-record values). |
| 17 | Manage Records — Accounts | POST | `/accounts/update_owners` | Reassign owner for many accounts. |
| 18 | Manage Records — Accounts | GET | `/account_stages` | List account stages. |
| 19 | Manage Records — Contacts | POST | `/contacts/search` | Search the team's saved contacts. |
| 20 | Manage Records — Contacts | GET | `/contacts/{contact_id}` | View one contact. |
| 21 | Manage Records — Contacts | POST | `/contacts` | Create one contact (optional dedupe). |
| 22 | Manage Records — Contacts | POST | `/contacts/bulk_create` | Create up to 100 contacts with dedupe. |
| 23 | Manage Records — Contacts | PATCH | `/contacts/{contact_id}` | Update one contact. |
| 24 | Manage Records — Contacts | POST | `/contacts/bulk_update` | Update up to 1,000 contacts (sync ≤100, async above). |
| 25 | Manage Records — Contacts | POST | `/contacts/update_stages` | Set the stage for many contacts. |
| 26 | Manage Records — Contacts | POST | `/contacts/update_owners` | Reassign owner for many contacts. |
| 27 | Manage Records — Contacts | GET | `/contact_stages` | List contact stages. |
| 28 | Manage Records — Deals | GET | `/opportunities/search` | List all deals. |
| 29 | Manage Records — Deals | GET | `/opportunities/{opportunity_id}` | View one deal. |
| 30 | Manage Records — Deals | POST | `/opportunities` | Create a deal. |
| 31 | Manage Records — Deals | PATCH | `/opportunities/{opportunity_id}` | Update a deal. |
| 32 | Manage Records — Deals | POST | `/contacts/{contact_id}/opportunities` | List deals associated with a contact. |
| 33 | Manage Records — Deals | GET | `/opportunity_stages` | List deal stages. |
| 34 | Manage Records — Lists | GET | `/labels` | List all lists (labels). |
| 35 | Manage Records — Lists | POST | `/labels` | Create an empty contact or account list. |
| 36 | Manage Records — Lists | PATCH | `/labels/{id}` | Rename a list / toggle Book-of-Business. |
| 37 | Manage Records — Lists | POST | `/labels/add_entity_ids_to_label_names` | Add contacts/accounts to lists by list name. |
| 38 | Manage Records — Lists | POST | `/labels/remove_entity_ids_from_label_names` | Remove contacts/accounts from lists by name. |
| 39 | Manage Records — Notes | GET | `/notes` | List notes attached to a contact/account/deal/meeting/conversation. |
| 40 | Engage — Sequences | POST | `/sequences` | Create a sequence with steps and email templates. |
| 41 | Engage — Sequences | PUT | `/sequences/{id}` | Update sequence settings, steps, and touches. |
| 42 | Engage — Sequences | POST | `/emailer_campaigns/search` | Search sequences. |
| 43 | Engage — Sequences | GET | `/emailer_schedules` | List sending schedules. |
| 44 | Engage — Sequences | POST | `/emailer_campaigns/{sequence_id}/add_contact_ids` | Enroll contacts in a sequence. |
| 45 | Engage — Sequences | POST | `/emailer_campaigns/remove_or_stop_contact_ids` | Finish, stop, or remove contacts from sequences. |
| 46 | Engage — Sequences | POST | `/emailer_campaigns/activity_feed` | Get one contact's sequence enrollment timeline. |
| 47 | Engage — Sequences | POST | `/emailer_campaigns/{sequence_id}/approve` | Activate a sequence. |
| 48 | Engage — Sequences | POST | `/emailer_campaigns/{sequence_id}/abort` | Deactivate a sequence. |
| 49 | Engage — Sequences | POST | `/emailer_campaigns/{sequence_id}/archive` | Archive a sequence. |
| 50 | Engage — Calls | POST | `/phone_calls` | Log a call made in an external dialer. |
| 51 | Engage — Calls | GET | `/phone_calls/search` | Search call records. |
| 52 | Engage — Calls | PUT | `/phone_calls/{id}` | Update a call record. |
| 53 | Engage — One-off Emails | POST | `/emailer_messages` | Create an email draft for a contact. |
| 54 | Engage — One-off Emails | POST | `/emailer_messages/{id}/send_now` | Send a drafted/scheduled/failed email immediately. |
| 55 | Engage — One-off Emails | POST | `/emailer_messages/email_send_status` | Check delivery status of an email. |
| 56 | Engage — One-off Emails | GET | `/emailer_messages/search` | Search outreach (sequence) emails. |
| 57 | Engage — One-off Emails | POST | `/emailer_messages/get_content` | Get subject/body/recipients of up to 10 sent emails. |
| 58 | Engage — One-off Emails | GET | `/emailer_messages/{id}/activities` | Get stats and details for one sequence email. |
| 59 | Engage — Tasks | POST | `/tasks/search` | Search tasks. |
| 60 | Engage — Tasks | GET | `/tasks/{id}` | Get one task with related records. |
| 61 | Engage — Tasks | POST | `/tasks` | Create a task. |
| 62 | Engage — Tasks | POST | `/tasks/bulk_create` | Create one task per contact for many contacts. |
| 63 | Engage — Tasks | POST | `/tasks/{id}/complete` | Mark a task completed. |
| 64 | Engage — Tasks | PATCH | `/tasks/{id}` | Update a task. |
| 65 | Engage — Tasks | POST | `/tasks/{id}/skip` | Mark a task skipped. |
| 66 | Engage — Conversations | POST | `/conversations/search` | Search recorded meetings/calls (conversation intelligence). |
| 67 | Engage — Conversations | GET | `/conversations/{id}` | Get one conversation incl. transcript and recordings. |
| 68 | Engage — Conversations | POST | `/conversations/export` | Start an async export of conversations in a time range. |
| 69 | Engage — Conversations | GET | `/conversations/export/{id}` | Get the download URL for a finished export. |
| 70 | AI Assistant | POST | `/agents/task` | Create, poll, or continue an AI Assistant task (conversation). |
| 71 | Workspace — Users | GET | `/users/search` | List workspace users. |
| 72 | Workspace — Users | GET | `/users/api_profile` | Get the acting user's profile (optionally credit usage). |
| 73 | Workspace — Users | GET | `/email_accounts` | List linked mailboxes. |
| 74 | Workspace — Fields | GET | `/fields` | List system, custom, and CRM-synced fields. |
| 75 | Workspace — Fields | POST | `/fields` | Create a custom field. |
| 76 | Workspace — Fields | PATCH | `/fields` | Update a custom field. |
| 77 | Workspace — Fields | GET | `/typed_custom_fields` | (Deprecated) list custom fields. |
| 78 | Analyze Performance | POST | `/reports/sync_report` | Query aggregated analytics (metrics × dimensions). |
| 79 | Usage & Webhooks | POST | `/usage_stats/api_usage_stats` | View per-endpoint API usage and rate limits. |
| 80 | Usage & Webhooks | POST | `/usage_stats/credit_usage_stats` | View team credit balances for the billing cycle. |
| 81 | Usage & Webhooks | GET | `/webhook_result/{request_id}` | Poll the result of an async enrichment webhook. |

---

## Per-endpoint detail

Notation: **Auth** lists the endpoint-scoped API key name (or "master only") and the OAuth scope. "Req" = required. `q` = query parameter, `b` = JSON body field, `p` = path parameter. Error responses (401/403/422/429) follow the common envelope and are omitted unless notable.

### 1. Search and Enrich Data — People

#### 1.1 People API Search — `POST /mixed_people/api_search`
Finds net-new people in Apollo's database. Returns obfuscated profiles; no emails or phone numbers (use enrichment for that).
- **Auth:** key `api/v1/mixed_people/api_search` or master · OAuth `mixed_people_api_search`. Free accounts need a work-email registration.
- **Credits / limits:** 0 credits. Display cap 50,000 records (100/page, 500 pages). Database-search rate tier.
- **Response:** `total_entries`, `people[]` (each: `id`, `first_name`, `last_name_obfuscated`, `title`, `last_refreshed_at`, `has_email`, `has_city`, `has_state`, `has_country`, `has_direct_phone`, `organization{}`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `person_titles[]` | q | string[] | | Job titles to match (any-of). |
| `include_similar_titles` | q | boolean | | Also match titles similar to `person_titles[]`. |
| `q_keywords` | q | string | | Free-text keyword filter. |
| `q_person_name` | q | string | | Search by person name. |
| `person_locations[]` | q | string[] | | Where the person lives (city/state/country). |
| `person_seniorities[]` | q | string[] | | Seniority: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern. |
| `organization_locations[]` | q | string[] | | Employer HQ location. |
| `q_organization_domains_list[]` | q | string[] | | Employer domains (current or past). |
| `not_organization_websites_list[]` | q | string[] | | Exclude employers by domain. |
| `contact_email_status[]` | q | string[] | | verified, unverified, likely to engage, unavailable. |
| `organization_ids[]` | q | string[] | | Restrict to employer organization IDs. |
| `lookalike_organization_ids[]` | q | string[] | | Seed companies for lookalike employer matching. |
| `organization_num_employees_ranges[]` | q | string[] | | Headcount ranges as `"min,max"` strings, e.g. `"250,500"`. |
| `revenue_range[min]` / `[max]` | q | integer | | Employer revenue bounds. |
| `currently_using_all_of_technology_uids[]` | q | string[] | | Employer uses all listed technologies. |
| `currently_using_any_of_technology_uids[]` | q | string[] | | Employer uses any listed technology. |
| `currently_not_using_any_of_technology_uids[]` | q | string[] | | Exclude by technology. |
| `q_organization_job_titles[]` | q | string[] | | Titles in employer's active job postings. |
| `organization_job_locations[]` | q | string[] | | Locations of employer's open jobs. |
| `organization_num_jobs_range[min]` / `[max]` | q | integer | | Count of active job postings. |
| `organization_job_posted_at_range[min]` / `[max]` | q | date string | | Job posting date window. |
| `organization_headcount_growth_past_n_months` | q | integer (6/12/24) | | Window for headcount growth filter. |
| `organization_headcount_growth_range[min]` / `[max]` | q | integer (%) | | Headcount growth bounds. |
| `page`, `per_page` | q | integer | | Pagination (max 100/page). |

#### 1.2 Get Complete Person Info — `GET /people/{id}`
Returns the full record for a database person, including employment history and current organization details. Unrevealed emails come back as the placeholder `email_not_unlocked@domain.com` rather than null.
- **Auth:** key `api/v1/people/show` or master · OAuth `person_read`. Work-email registration required on free plans.
- **Credits:** 1 credit per person. Enrichment rate tier.
- **Response:** `person{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Apollo person ID (from people search). |

#### 1.3 People Enrichment — `POST /people/match`
Matches one person from whatever identifiers are supplied and returns enriched data; optional personal email, phone, and waterfall enrichment. Weak inputs can yield 200 with no match.
- **Auth:** key `api/v1/people/match` or master · OAuth `people_match`.
- **Credits:** roughly 1–9 credits per person without waterfall; charged only when data is returned. Phone/waterfall results are delivered asynchronously.
- **Response:** `request_id`, `person{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `first_name`, `last_name`, `name` | q | string | | Person name (split or full). |
| `email` | q | string | | Email address. |
| `hashed_email` | q | string | | MD5 or SHA-256 hash of email. |
| `organization_name` | q | string | | Employer name. |
| `domain` | q | string | | Employer domain (no `www.`). |
| `id` | q | string | | Apollo person ID. |
| `linkedin_url` | q | string | | LinkedIn profile URL. |
| `reveal_personal_emails` | q | boolean | | Also return personal emails (consumes credits). |
| `reveal_phone_number` | q | boolean | | Also return phone numbers (async; needs webhook or polling). |
| `run_waterfall_email` / `run_waterfall_phone` | q | boolean | | Use third-party waterfall enrichment. |
| `webhook_url` | q | string | | Callback for async phone/waterfall results (required with phone reveal unless polling). |
| `poll_only` | q | boolean | | Retrieve async results via polling instead of webhook. |

#### 1.4 Bulk People Enrichment — `POST /people/bulk_match`
Same as 1.3 for up to 10 people per request.
- **Auth:** key `api/v1/people/bulk_match` or master · OAuth `people_bulk_match`.
- **Credits:** 1–9 per person (without waterfall). Free plan: 20 req/min for bulk.
- **Response:** `request_id`, `status`, `error_code`, `error_message`, `total_requested_enrichments`, `unique_enriched_records`, `missing_records`, `credits_consumed`, `waterfall`, `phone_enrichment`, `matches[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `details[]` | b | object[] | Req | Up to 10 person descriptors, each with the same identifier fields as 1.3 (`first_name`, `last_name`, `name`, `email`, `hashed_email`, `organization_name`, `domain`, `id`, `linkedin_url`). |
| `reveal_personal_emails`, `reveal_phone_number`, `run_waterfall_email`, `run_waterfall_phone`, `webhook_url`, `poll_only` | q | various | | As in 1.3, applied to all matches. |

### 2. Search and Enrich Data — Companies

#### 2.1 Organization Search — `POST /mixed_companies/search`
Finds companies in Apollo's database (not yet saved as accounts).
- **Auth:** key `api/v1/mixed_companies/search` or master · OAuth `mixed_companies_search`.
- **Credits / limits:** 1 credit per page. Display cap 50,000 records.
- **Response:** search envelope + `accounts[]`, `organizations[]`, `model_ids`, `derived_params`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `q_organization_name` | q | string | | Company name filter. |
| `q_organization_domains_list[]` | q | string[] | | Company domains. |
| `not_organization_websites_list[]` | q | string[] | | Exclude domains. |
| `organization_ids[]` | q | string[] | | Restrict to IDs. |
| `lookalike_organization_ids[]` | q | string[] | | Lookalike seed companies (results ranked by similarity). |
| `organization_num_employees_ranges[]` | q | string[] | | Headcount ranges `"min,max"`. |
| `organization_locations[]` / `organization_not_locations[]` | q | string[] | | Include/exclude HQ locations. |
| `revenue_range[min]` / `[max]` | q | integer | | Revenue bounds. |
| `currently_using_any_of_technology_uids[]` | q | string[] | | Technology filter. |
| `q_organization_keyword_tags[]` | q | string[] | | Industry/keyword tags. |
| `latest_funding_amount_range[min]` / `[max]` | q | integer | | Latest round size. |
| `total_funding_range[min]` / `[max]` | q | integer | | Total funding. |
| `latest_funding_date_range[min]` / `[max]` | q | date | | Latest round date. |
| `q_organization_job_titles[]`, `organization_job_locations[]` | q | string[] | | Hiring filters. |
| `organization_num_jobs_range[min]` / `[max]` | q | integer | | Active job count. |
| `organization_job_posted_at_range[min]` / `[max]` | q | date | | Job posting window. |
| `organization_headcount_growth_past_n_months` | q | 6/12/24 | | Growth window. |
| `organization_headcount_growth_range[min]` / `[max]` | q | integer (%) | | Growth bounds. |
| `page`, `per_page` | q | integer | | Pagination. |

#### 2.2 Get Complete Organization Info — `GET /organizations/{id}`
Full detail for one database organization.
- **Auth:** key `api/v1/organizations/show` or master · OAuth `organization_read`.
- **Credits:** 1 credit per company.
- **Response:** `organization{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Apollo organization ID. |

#### 2.3 Organization Enrichment — `GET /organizations/enrich`
Enriches a single company; returns firmographics, funding, technologies, hierarchy (`owned_by_organization`, `owned_by_chain`, `ultimate_parent_organization`), headcount growth.
- **Auth:** key `api/v1/organizations/enrich` or master · OAuth `organizations_enrich`.
- **Credits:** 1 credit per organization. Returns `error_details`-only errors.
- **Response:** `organization{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `domain` | q | string | one of domain/linkedin_url/website | Company domain. |
| `linkedin_url` | q | string | | Company LinkedIn URL. |
| `website` | q | string | | Full website URL. |
| `name` | q | string | | Company name (improves match accuracy). |

#### 2.4 Bulk Organization Enrichment — `POST /organizations/bulk_enrich`
Enriches up to 10 companies via a `domains[]` list or a `details` array.
- **Auth:** key `api/v1/organizations/bulk_enrich` or master · OAuth `organizations_bulk_enrich`.
- **Credits:** 1 per organization.
- **Response:** `status`, `error_code`, `error_message`, `total_requested_records`, `total_requested_domains`, `unique_domains`, `unique_records`, `unique_enriched_records`, `missing_records`, `organizations[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `domains[]` | q | string[] | | Domains to enrich. |
| `details[]` | b | object[] | | Up to 10 descriptors combining `domain`, `linkedin_url`, `name`, `website`. |

#### 2.5 Organization Job Postings — `GET /organizations/{organization_id}/job_postings`
Lists current job postings for a company (hiring signal).
- **Auth:** key `api/v1/organizations/job_postings` or master · OAuth `organizations_job_posting`.
- **Credits / limits:** 1 credit per page; display cap 10,000.
- **Response:** `organization_job_postings[]` (`id`, `title`, `url`, `city`, `state`, `country`, `last_seen_at`, `posted_at`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `organization_id` | p | string | Req | Organization ID. |
| `page`, `per_page` | q | integer | | Pagination. |

#### 2.6 News Articles Search — `POST /news_articles/search`
Finds news about given companies, filterable by category and date.
- **Auth:** key `api/v1/news_articles/search` or master · OAuth `organizations_news_articles`.
- **Credits:** 1 credit per page (up to 25 results/page).
- **Response:** `pagination`, `news_articles[]` (`id`, `url`, `domain`, `title`, `snippet`, `organization_ids[]`, `published_at`, `event_categories[]`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `organization_ids[]` | q | string[] | Req | Companies to search news for. |
| `categories[]` | q | string[] | | News categories/sub-categories. |
| `published_at[min]` / `[max]` | q | date | | Publication date window. |
| `page`, `per_page` | q | integer | | Pagination. |

### 3. Manage Records — Accounts

#### 3.1 Search for Accounts — `POST /accounts/search`
Searches companies already saved as accounts by the team.
- **Auth:** key `api/v1/accounts/search` or master · OAuth `accounts_search`. 0 credits. Display cap 50,000.
- **Response:** search envelope + `accounts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `q_organization_name` | b | string | | Keyword match on account name. |
| `account_stage_ids` | b | string[] | | Filter by stage. |
| `account_label_ids` | b | string[] | | Filter by list. |
| `sort_by_field` | b | enum | | `account_last_activity_date`, `account_created_at`, `account_updated_at`. |
| `sort_ascending` | b | boolean | | Ascending sort (needs `sort_by_field`). |
| `page`, `per_page` | b | integer | | Pagination. |

#### 3.2 View an Account — `GET /accounts/{id}`
- **Auth:** key `api/v1/accounts/show` or master · OAuth `account_read`. 0 credits.
- **Response:** `account{}`, `salesforce_users`, `hubspot_owners`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Account ID. |

#### 3.3 Create an Account — `POST /accounts`
Creates one account. No deduplication — duplicates are created if details match an existing account.
- **Auth:** key `api/v1/accounts/create` or master · OAuth `account_write`. 0 credits.
- **Response:** `account{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `name` | b | string | | Display name. |
| `domain` | b | string | | Domain (no `www.`). |
| `owner_id` | b | string | | Owning user. |
| `account_stage_id` | b | string | | Stage. |
| `phone` | b | string | | Primary phone. |
| `raw_address` | b | string | | HQ location text (Apollo normalizes). |
| `typed_custom_fields` | b | object | | Custom field values keyed by field ID. |

#### 3.4 Bulk Create Accounts — `POST /accounts/bulk_create`
Creates up to 100 accounts; returns new and already-existing matches separately (existing ones are not modified).
- **Auth:** key `api/v1/accounts/bulk_create` or master · OAuth `account_bulk_create`. 0 credits.
- **Response:** `created_accounts[]`, `existing_accounts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `accounts` | b | object[] | Req | Account attribute objects (≤100). |
| `append_label_names` | b | string[] | | Lists to add every account to. |
| `run_dedupe` | b | boolean | | Aggressive dedupe by domain, organization_id, and name (default matches by CRM IDs only). |

#### 3.5 Update an Account — `PATCH /accounts/{account_id}`
- **Auth:** key `api/v1/accounts/update` or master · OAuth `account_update`. 0 credits.
- **Response:** `account{}`, `labels`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `account_id` | p | string | Req | Account to update. |
| `name`, `domain`, `owner_id`, `account_stage_id`, `raw_address`, `phone`, `typed_custom_fields` | b | various | | Same fields as create. |

#### 3.6 Bulk Update Accounts — `POST /accounts/bulk_update`
Updates up to 1,000 accounts, either applying the same values to `account_ids` or per-record values via `account_attributes`. Async mode works only with `account_ids`.
- **Auth:** key `api/v1/accounts/bulk_update` or master · OAuth `account_stages_update`. 0 credits.
- **Response:** `accounts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `account_ids` | b | string[] | one of ids/attributes | Accounts to receive identical updates. |
| `account_attributes` | b | object[] | | Per-account update objects (each with `id`). |
| `name`, `owner_id`, `account_stage_id` | b | string | | Shared values (with `account_ids`). |
| `async` | b | boolean | | Background processing (ids mode only). |

#### 3.7 Update Account Owner for Multiple Accounts — `POST /accounts/update_owners`
- **Auth:** key `api/v1/accounts/update_owners` or master · OAuth `account_owners_update`. 0 credits.
- **Response:** `accounts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `account_ids[]` | q | string[] | Req | Accounts to reassign. |
| `owner_id` | q | string | Req | New owner. |

#### 3.8 List Account Stages — `GET /account_stages`
- **Auth:** key `api/v1/account_stages/index` or master · OAuth `account_stages_list`. 0 credits. No params.
- **Response:** `account_stages[]` (`id`, `team_id`, `display_name`, `name`, `display_order`, `default_exclude_for_leadgen`, `category`, `is_meeting_set`).

### 4. Manage Records — Contacts

#### 4.1 Search for Contacts — `POST /contacts/search`
Searches people saved as contacts by the team.
- **Auth:** key `api/v1/contacts/search` or master · OAuth `contacts_search`. 0 credits. Display cap 50,000.
- **Response:** search envelope + `contacts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `q_keywords` | b | string | | Keyword search (name, title, company, email). |
| `contact_stage_ids` | b | string[] | | Filter by stage. |
| `contact_label_ids` | b | string[] | | Filter by list. |
| `sort_by_field` | b | enum | | `contact_last_activity_date`, `contact_email_last_opened_at`, `contact_email_last_clicked_at`, `contact_created_at`, `contact_updated_at`. |
| `sort_ascending` | b | boolean | | Ascending sort. |
| `page`, `per_page` | b | integer | | Pagination. |

#### 4.2 View a Contact — `GET /contacts/{contact_id}`
- **Auth:** key `api/v1/contacts/show` or master · OAuth `contact_read`. 0 credits.
- **Response:** `contact{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id` | p | string | Req | Contact ID. |

#### 4.3 Create a Contact — `POST /contacts`
Creates one contact. Without `run_dedupe` duplicates are allowed; with it, a match is updated in place instead of creating a new record.
- **Auth:** key `api/v1/contacts/create` or master · OAuth `contact_write`. 0 credits.
- **Response:** `contact{}`, `labels`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `first_name`, `last_name` | b | string | | Name. |
| `organization_name` | b | string | | Employer name. |
| `title` | b | string | | Job title. |
| `account_id` | b | string | | Link to saved account. |
| `email` | b | string | | Email address. |
| `website_url` | b | string | | Employer website. |
| `label_names` | b | string[] | | Lists to place the contact in. |
| `contact_stage_id` | b | string | | Stage. |
| `present_raw_address` | b | string | | Personal location text. |
| `direct_phone`, `corporate_phone`, `mobile_phone`, `home_phone`, `other_phone` | b | string | | Typed phone numbers. |
| `typed_custom_fields` | b | object | | Custom field values. |
| `run_dedupe` | b | boolean | | Match/update existing contacts instead of duplicating. |

#### 4.4 Bulk Create Contacts — `POST /contacts/bulk_create`
Creates up to 100 contacts with dedupe; returns created vs existing arrays.
- **Auth:** key `api/v1/contacts/bulk_create` or master · OAuth `contacts_bulk_create`. 0 credits.
- **Response:** `created_contacts[]`, `existing_contacts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contacts` | b | object[] | Req | Contact objects (≤100), same fields as 4.3. |
| `append_label_names` | b | string[] | | Lists to apply to all. |
| `owner_id` | b | string | | Owner for all (defaults to acting user). |
| `run_dedupe` | b | boolean | | Full dedupe across sources. |

#### 4.5 Update a Contact — `PATCH /contacts/{contact_id}`
- **Auth:** key `api/v1/contacts/update` or master · OAuth `contact_update`. 0 credits.
- **Response:** `contact{}`, `labels`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id` | p | string | Req | Contact to update. |
| Same body fields as 4.3 (except `run_dedupe`) | b | various | | `label_names` **replaces** existing list membership. |

#### 4.6 Bulk Update Contacts — `POST /contacts/bulk_update`
Updates up to 1,000 contacts; ≤100 synchronous, 101–1,000 asynchronous (or forced with `async`).
- **Auth:** key `api/v1/contacts/bulk_update` or master · OAuth `contacts_bulk_update`. 0 credits.
- **Response:** `contacts[]`, `entity_progress_job`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_ids` | b | string[] | one of ids/attributes | Contacts receiving identical updates. |
| `contact_attributes` | b | object[] | | Per-contact updates. |
| `owner_id`, `email`, `organization_name`, `title`, `first_name`, `last_name`, `account_id`, `present_raw_address`, `linkedin_url`, `typed_custom_fields` | b | various | | Shared values (ids mode). |
| `async` | b | boolean | | Force background processing. |
| `visible_entity_ids` | b | string[] | | Limit which updated contacts are returned. |

#### 4.7 Update Contact Stage for Multiple Contacts — `POST /contacts/update_stages`
- **Auth:** key `api/v1/contacts/update_stages` or master · OAuth `contact_stages_update`. 0 credits.
- **Response:** `contacts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_ids[]` | q | string[] | Req | Contacts. |
| `contact_stage_id` | q | string | Req | Target stage. |

#### 4.8 Update Contact Owner for Multiple Contacts — `POST /contacts/update_owners`
- **Auth:** key `api/v1/contacts/update_owners` or master · OAuth `contact_owners_update`. 0 credits.
- **Response:** `contacts[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_ids[]` | q | string[] | Req | Contacts. |
| `owner_id` | q | string | Req | New owner. |

#### 4.9 List Contact Stages — `GET /contact_stages`
- **Auth:** key `api/v1/contact_stages/index` or master · OAuth `contact_stages_list`. 0 credits. No params.
- **Response:** `contact_stages[]` (stage objects analogous to account stages: id, name, display order).

### 5. Manage Records — Deals (Opportunities)

Note: endpoint-key names for deals are prefixed `deals/api/v1/...`.

#### 5.1 List All Deals — `GET /opportunities/search`
- **Auth:** key `deals/api/v1/opportunities/search` or master · OAuth `opportunities_list`. 0 credits.
- **Response:** search envelope + `opportunities[]`, `salesforce_users`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `sort_by_field` | q | enum | | `amount`, `is_closed`, `is_won`. |
| `page`, `per_page` | q | integer | | Pagination. |

#### 5.2 View Deal — `GET /opportunities/{opportunity_id}`
- **Auth:** key `deals/api/v1/opportunities/show` or master · OAuth `opportunity_read`. 0 credits. Returns 404 for unknown IDs.
- **Response:** `opportunity{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `opportunity_id` | p | string | Req | Deal ID. |

#### 5.3 Create Deal — `POST /opportunities`
- **Auth:** key `deals/api/v1/opportunities/create` or master · OAuth `opportunity_write`. 0 credits.
- **Response:** `opportunity{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `name` | b | string | Req | Deal name. |
| `owner_id` | b | string | | Owner. |
| `account_id` | b | string | | Target account. |
| `amount` | b | string | | Value without separators/symbols; currency from team settings. |
| `opportunity_stage_id` | b | string | | Stage. |
| `closed_date` | b | date (YYYY-MM-DD) | | Expected close date. |
| `typed_custom_fields` | b | object | | Custom fields. |

#### 5.4 Update Deal — `PATCH /opportunities/{opportunity_id}`
- **Auth:** key `deals/api/v1/opportunities/update` or master · OAuth `opportunity_update`. 0 credits.
- **Response:** `opportunity{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `opportunity_id` | p | string | Req | Deal ID. |
| `owner_id`, `name`, `amount`, `opportunity_stage_id`, `closed_date`, `typed_custom_fields` | b | various | | Fields to change. |

#### 5.5 View Associated Deals — `POST /contacts/{contact_id}/opportunities`
Lists deals linked to a contact; empty array (not 404) when none/unknown. Body ignored.
- **Auth:** key `deals/api/v1/opportunities/search` or master · OAuth `opportunities_list`. 0 credits.
- **Response:** `opportunities[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id` | p | string | Req | Contact ID. |

#### 5.6 List Deal Stages — `GET /opportunity_stages`
- **Auth:** key `deals/api/v1/opportunity_stages/index` or master · OAuth `opportunity_stages_list`. 0 credits. No params.
- **Response:** `opportunity_stages[]` (`id`, `team_id`, `name`, `display_order`, `forecast_category_cd`, `is_won`, `is_closed`, `probability`, `description`, `salesforce_id`, `is_meeting_set`, `opportunity_pipeline_id`, `is_editable`, `type`).

### 6. Manage Records — Lists (Labels)

#### 6.1 Get a List of All Lists — `GET /labels`
- **Auth:** key `api/v1/labels/index` or master · OAuth `tags_list`. 0 credits. No params.
- **Response:** array of labels (`id`, `name`, `modality`, `cached_count`, `team_id`, `user_id`, `created_at`, `updated_at`, ...).

#### 6.2 Create a List — `POST /labels`
Creates an empty list; names must be unique per modality (422 otherwise).
- **Auth:** key `api/v1/labels/create` or master · OAuth `lists_create`. 0 credits.
- **Response:** `label{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `name` | b | string | Req | List name. |
| `modality` | b | `contacts` \| `accounts` | Req | Record type held. |
| `book_of_business` | b | boolean | | Mark an account list as Book of Business. |

#### 6.3 Update a List — `PATCH /labels/{id}`
Rename or toggle Book of Business; modality is immutable.
- **Auth:** key `api/v1/labels/update` or master · OAuth `lists_update`. 0 credits.
- **Response:** `label{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | List ID. |
| `name` | b | string | Req | New name. |
| `book_of_business` | b | boolean | | Account lists only. |

#### 6.4 Add Records to a List — `POST /labels/add_entity_ids_to_label_names`
Adds records to lists by list *name*; missing lists are auto-created.
- **Auth:** key `api/v1/labels/add_entity_ids_to_label_names` or master · OAuth `lists_add_entities`. 0 credits.
- **Response:** `labels`, `message`, `entity_progress_job`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `entity_ids` | b | string[] | Req | Contact or account IDs (invalid ones ignored). |
| `label_names` | b | string[] | Req | Target list names. |
| `modality` | b | `contacts` \| `accounts` | Req | Record type. |
| `async` | b | boolean | | Process in background. |

#### 6.5 Remove Records from a List — `POST /labels/remove_entity_ids_from_label_names`
Same shape as 6.4; removes membership only (records are not deleted).
- **Auth:** key `api/v1/labels/remove_entity_ids_from_label_names` or master · OAuth `lists_remove_entities`. 0 credits.

### 7. Manage Records — Notes

#### 7.1 Get a List of Notes — `GET /notes`
Lists notes attached to a related record; at least one relation filter is required.
- **Auth:** key `meetings/api/v1/notes/index` or master · OAuth `notes_list`. 0 credits.
- **Response:** `notes[]` (`id`, `user_id`, `content`, `created_at`, `updated_at`, `contact_id`, `account_id`, `opportunity_id`, `conversation_id`, `pinned_to_top`, `system`, plural `*_ids` arrays, `is_org_chart_note`, `crm_notes`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id`, `account_id`, `opportunity_id`, `calendar_event_id`, `conversation_id` | q | string | at least one relation | Parent record. |
| `contact_ids`, `conversation_ids` | q | string[] | | Multiple parents. |
| `start_date` | q | date | | Created on/after. |
| `sort_by_field` | q | `created_at` \| `updated_at` | | Sort field (default created_at). |
| `sort_direction` | q | `asc` \| `desc` | | Default desc. |
| `skip` | q | integer | | Offset. |
| `limit` | q | integer | | Page size (default 25, max 100). |

### 8. Engage with Prospects — Sequences

#### 8.1 Create a Sequence — `POST /sequences`
Creates a sequence including ordered steps, touches (email variants; >1 = A/B test), and templates. Can be activated on creation.
- **Auth:** key `api/v1/sequences/create` or master · OAuth `emailer_campaigns_create`. 0 credits.
- **Response:** `emailer_campaign{}`, `emailer_steps[]`, `emailer_touches[]`, `emailer_templates[]`, `attachments[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `name` | b | string | | Sequence name. |
| `active` | b | boolean | | Activate immediately. |
| `emailer_schedule_id` | b | string | | Sending schedule. |
| `label_names` | b | string[] | | Labels/folders (auto-created). |
| `folder_id` | b | string | | Folder. |
| `sequence_by_exact_daytime` | b | boolean | | Steps use absolute datetimes instead of relative waits. |
| `max_emails_per_day` | b | integer | | Daily send cap. |
| `mark_finished_if_reply` / `_if_click` / `_if_interested` | b | boolean | | Auto-finish triggers. |
| `mark_paused_if_ooo` | b | boolean | | Pause on out-of-office. |
| `days_to_wait_before_mark_as_response` | b | integer | | Reply attribution window. |
| `create_task_if_email_open`, `email_open_trigger_task_threshold` | b | boolean / integer | | Create task after N opens. |
| `same_account_reply_delay_days` | b | integer | | Pause same-account contacts after a reply (≤1000). |
| `excluded_account_stage_ids`, `excluded_contact_stage_ids` | b | string[] | | Stage-based exclusions. |
| `ignore_apollo_global_email_bounce_list` | b | boolean | | Send despite global bounce list. |
| `sequence_ruleset_id` | b | string | | Shared ruleset. |
| `emailer_steps[]` | b | object[] | | Ordered steps: `type` (`auto_email`, `manual_email`, `call`, `action_item`, `linkedin_step_connect`, `linkedin_step_message`, `linkedin_step_view_profile`, `linkedin_step_interact_post`), `wait_time`, `wait_mode` (`minute`/`hour`/`day`), `exact_datetime`, `priority`, `note`, `max_emails_per_day`, `auto_skip_in_x_days`, `emailer_touches[]` (subject/body/status). |
| `permissions`, `user_id` | b | string | | Deprecated / ignored (owner is acting user). |

#### 8.2 Update a Sequence — `PUT /sequences/{id}`
Updates settings and reconciles steps/touches by ID (include `id` to update, omit to create, omitted existing ones are removed). Can reassign owner.
- **Auth:** key `api/v1/sequences/update` or master · OAuth `emailer_campaigns_update`. 0 credits.
- **Response:** `id`, `name`, `active`, `archived`, `created_at`, `updated_at`, `num_steps`, `steps`, `emailer_campaign`, `emailer_steps`, `emailer_touches`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Sequence ID. |
| `name`, `active` | b | string / boolean | | Name and on/off. |
| `creation_type` | b | `draft` \| `new` \| `ai_assistant` | | Draft auto-promotes when steps added. |
| `sharing_permission` | b | object | | Access control (replaces `permissions`). |
| `user_id` | b | string | | New owner. |
| `emailer_schedule_id`, `label_names`, `max_emails_per_day`, `same_account_reply_delay_days` | b | various | | Settings. |
| `cc_emails`, `bcc_emails` | b | string (comma-separated) | | CC/BCC for all sequence emails. |
| `emailer_steps[]` | b | object[] | | Full ordered step list. |

#### 8.3 Search for Sequences — `POST /emailer_campaigns/search`
- **Auth:** key `api/v1/emailer_campaigns/search` or master · OAuth `emailer_campaigns_search`. 0 credits.
- **Response:** `pagination`, `breadcrumbs`, `emailer_campaigns[]` (includes per-sequence stats and `sharing_permission`), `num_fetch_result`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `q_name` | q | string | | Name keyword. |
| `page`, `per_page` | q | string | | Pagination. |

#### 8.4 List Email Schedules — `GET /emailer_schedules`
- **Auth:** key `api/v1/emailer_schedules/index` or master · OAuth `emailer_schedules_list`. 0 credits. No params.
- **Response:** `emailer_schedules[]` (`id`, `name`, `default`, `time_zone`, `schedule_hash` (weekly windows), `created_at`, `use_contacts_time_zone`, `skip_holidays`).

#### 8.5 Add Contacts to a Sequence — `POST /emailer_campaigns/{sequence_id}/add_contact_ids`
Enrolls saved contacts (not database people) with a sending mailbox and safety overrides.
- **Auth:** key `api/v1/emailer_campaigns/add_contact_ids` or master · OAuth `emailer_campaigns_add_contact_ids`. 0 credits.
- **Response:** `contacts[]`, `skipped_contact_ids`, `emailer_campaign`, `emailer_steps`, `emailer_touches`, `team`, `signals_hash`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `sequence_id` | p | string | Req | Sequence. |
| `emailer_campaign_id` | q | string | Req | Same as `sequence_id`. |
| `contact_ids[]` | q | string[] | | Contacts to add. |
| `label_names[]` | q | string[] | | Alternative: add contacts in these lists. |
| `send_email_from_email_account_id` | q | string or string[] | Req | Mailbox(es) to send from. |
| `send_email_from_email_address` | q | string | | Specific alias. |
| `sequence_no_email`, `sequence_unverified_email`, `sequence_job_change`, `sequence_active_in_other_campaigns`, `sequence_finished_in_other_campaigns`, `sequence_same_company_in_same_campaign`, `contacts_without_ownership_permission`, `add_if_in_queue`, `contact_verification_skipped` | q | boolean | | Override individual enrollment safeguards. |
| `user_id` | q | string | | Acting user. |
| `status` | q | `active` \| `paused` | | Initial enrollment status. |
| `auto_unpause_at` | q | datetime | | Scheduled unpause (with `paused`). |

#### 8.6 Update Contact Status in a Sequence — `POST /emailer_campaigns/remove_or_stop_contact_ids`
- **Auth:** key `api/v1/emailer_campaigns/remove_or_stop_contact_ids` or master · OAuth `emailer_campaigns_remove_or_stop_contact_ids`. 0 credits.
- **Response:** `entity_progress_job`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `emailer_campaign_ids[]` | q | string[] | Req | Sequences. |
| `contact_ids[]` | q | string[] | Req | Contacts. |
| `mode` | q | `mark_as_finished` \| `remove` \| `stop` | Req | Action. |

#### 8.7 Get Contact Sequence Activity — `POST /emailer_campaigns/activity_feed`
Timeline of one contact's enrollment events (added, paused, resumed, failed, finished, removed, replied).
- **Auth:** key `api/v1/emailer_campaigns/activity_feed` or master · OAuth `emailer_campaigns_activity_feed`. 0 credits. 404 if contact not in team.
- **Response:** `contact_id`, `events[]` (`type`, `occurred_at`, `sequence_id`, `sequence_name`, `step_position`, `reason`, `emailer_message_id`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id` | b | string | Req | Contact. |
| `sequence_id` | b | string | | Limit to one sequence. |
| `per_page` | b | integer (1–50) | | Max events (default 50). |

#### 8.8–8.10 Activate / Deactivate / Archive a Sequence
| Endpoint | Path | Key / OAuth scope | Effect | Response |
| --- | --- | --- | --- | --- |
| Activate | `POST /emailer_campaigns/{sequence_id}/approve` | `api/v1/emailer_campaigns/approve` / `emailer_campaigns_approve` | Starts sending (needs ≥1 step). | `emailer_campaign`, `emailer_steps` |
| Deactivate | `POST /emailer_campaigns/{sequence_id}/abort` | `api/v1/emailer_campaigns/abort` / `emailer_campaigns_abort` | Stops sending, pauses contacts. | `emailer_campaign`, `emailer_steps` |
| Archive | `POST /emailer_campaigns/{sequence_id}/archive` | `api/v1/emailer_campaigns/archive` / `emailer_campaigns_archive` | Marks inactive and finishes all contacts; owner or full-access only. | `emailer_campaign` |

All take only `sequence_id` (path, required); 0 credits.

### 9. Engage with Prospects — Calls

All call endpoints require a **master API key**.

#### 9.1 Create Call Records — `POST /phone_calls`
Logs a call made in an external dialer (does not place calls).
- **Auth:** master only · OAuth `phone_call_write`. 0 credits.
- **Response:** `phone_call{}`, `contact`, `team`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `logged` | q | boolean | | Create an individual call record. |
| `user_id[]` | q | string[] | | Caller(s). |
| `contact_id` | q | string | | Contact called. |
| `account_id` | q | string | | Related account. |
| `to_number`, `from_number` | q | string | | Phone numbers. |
| `status` | q | string | | queued, ringing, in-progress, completed, no_answer, failed, busy. |
| `start_time`, `end_time` | q | ISO datetime | | Call times (GMT). |
| `duration` | q | integer (s) | | Duration in seconds. |
| `phone_call_purpose_id` | q | string | | Team-defined purpose. |
| `phone_call_outcome_id` | q | string | | Team-defined disposition. |
| `note` | q | string | | Note. |

#### 9.2 Search for Calls — `GET /phone_calls/search`
- **Auth:** master only · OAuth `phone_call_search`. 0 credits.
- **Response:** paginated call list (shape not specified in schema).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `date_range[min]` / `[max]` | q | date | | Call date window. |
| `duration[min]` / `[max]` | q | integer (s) | | Duration bounds. |
| `inbound` | q | `incoming` \| `outgoing` | | Direction. |
| `user_ids[]` | q | string[] | | Callers. |
| `contact_label_ids[]` | q | string[] | | Contacts involved. |
| `phone_call_purpose_ids[]`, `phone_call_outcome_ids[]` | q | string[] | | Purpose / disposition. |
| `q_keywords` | q | string | | Keyword search. |
| `page`, `per_page` | q | string | | Pagination. |

#### 9.3 Update Call Records — `PUT /phone_calls/{id}`
Same fields as 9.1, plus `id` (path, required).
- **Auth:** master only · OAuth `phone_call_update`. 0 credits.
- **Response:** `phone_call{}`, `contact`.

### 10. Engage with Prospects — One-off Emails

#### 10.1 Create an Email Draft — `POST /emailer_messages`
Creates an unsent (`drafted`) email for a contact, or a reply within an existing thread.
- **Auth:** key `api/v1/emailer_messages/create` or master · OAuth `emailer_messages_create`. 0 credits.
- **Response:** `emailer_message{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `contact_id` | b | string | Req unless replying | Recipient contact. |
| `in_response_to_emailer_message_id` | b | string | | Reply to this message (infers contact/recipients). |
| `subject` | b | string | | Subject. |
| `body_html` | b | string | | HTML body (sanitized). |
| `recipients` | b | object[] | | to/cc/bcc recipients. |
| `emailer_template_id` | b | string | | Associated template. |
| `attachment_ids` | b | string[] | | Attachments. |
| `enable_tracking` | b | boolean | | Open/click tracking. |
| `outreach_task_id` | b | string | | Link to a task. |

#### 10.2 Send Email Now — `POST /emailer_messages/{id}/send_now`
Queues a drafted/scheduled/failed email for immediate async send.
- **Auth:** key `api/v1/emailer_messages/send_now` or master · OAuth `emailer_messages_send_now`. 0 credits.
- **Response:** `emailer_message{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Message ID. |
| `surface` | b | string | | Originating UI surface (attribution). |

#### 10.3 Check Email Send Status — `POST /emailer_messages/email_send_status`
- **Auth:** key `api/v1/emailer_messages/email_send_status` or master · OAuth `emailer_messages_email_send_status`. 0 credits.
- **Response:** `id`, `status`, `message`, `completed_at`, `not_sent_reason`, `failure_reason`, `failed_at`, `retry_after_seconds`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | b | string | Req | Message ID. |

#### 10.4 Search for Outreach Emails — `GET /emailer_messages/search`
Searches emails created/sent through sequences. Display cap 50,000.
- **Auth:** key `api/v1/emailer_messages/search` or master · OAuth `emailer_messages_search`. 0 credits.
- **Response:** paginated `emailer_messages[]` (shape not specified in schema).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `emailer_message_stats[]` | q | string[] | | delivered, scheduled, drafted, not_opened, opened, clicked, unsubscribed, demoed, bounced, spam_blocked, failed_other. |
| `emailer_message_reply_classes[]` | q | string[] | | Reply sentiment: willing_to_meet, follow_up_question, person_referral, out_of_office, already_left_company_or_not_right_person, not_interested, unsubscribe, none_of_the_above. |
| `user_ids[]` | q | string[] | | Senders. |
| `email_account_id_and_aliases` | q | string | | Sending mailbox/alias. |
| `emailer_campaign_ids[]` / `not_emailer_campaign_ids[]` | q | string[] | | Include/exclude sequences. |
| `emailer_message_date_range_mode` | q | `due_at` \| `completed_at` | | Which date the range applies to. |
| `emailer_message_date_range[min]` / `[max]` | q | date | | Date window. |
| `not_sent_reason_cds[]` | q | string[] | | Why not sent (e.g. contact_stage_safeguard, ...). |
| `q_keywords` | q | string | | Keyword search. |
| `page`, `per_page` | q | integer | | Pagination. |

#### 10.5 Get Email Content — `POST /emailer_messages/get_content`
Returns subject, body, and recipients for up to 10 *sent* outbound emails (drafts, failures, inbound excluded; unknown IDs silently omitted).
- **Auth:** key `api/v1/emailer_messages/get_content` or master · OAuth `emailer_messages_get_content`. 0 credits.
- **Response:** `emailer_messages[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `ids` | b | string[] | Req | ≤10 message IDs. |
| `body_format` | b | `plain` \| `html` | | Body format (default plain). |

#### 10.6 Check Email Stats — `GET /emailer_messages/{id}/activities`
Full detail for one sequence email: content, opens/clicks, and recipient contact.
- **Auth:** master only · OAuth not supported. 0 credits.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Message ID. |

### 11. Engage with Prospects — Tasks

#### 11.1 Search for Tasks — `POST /tasks/search`
- **Auth:** key `api/v1/tasks/search` or master · OAuth `tasks_list`. 0 credits. Display cap 50,000.
- **Response:** `tasks[]`, `breadcrumbs`, `pagination`, `faceting`, `pipeline_total`, `num_fetch_result`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `sort_by_field` | q | `task_due_at` \| `task_priority` | | Sort. |
| `open_factor_names[]` | q | string[] | | Pass `task_types` to get counts by type. |
| `page`, `per_page` | q | integer | | Pagination. |

#### 11.2 Get a Task — `GET /tasks/{id}`
Returns task with embedded `account`, `contact`, `opportunity`, and type-specific extras (`phone_call`, `emailer_message`, LinkedIn template).
- **Auth:** key `api/v1/tasks/show` or master · OAuth `tasks_list`. 0 credits.
- **Response:** `task{}`.

#### 11.3 Create a Task — `POST /tasks`
Creates one task (no dedupe).
- **Auth:** key `api/v1/tasks/create` or master · OAuth `tasks_create`. 0 credits.
- **Response:** `task{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `user_id` | b | string | Req | Task owner. |
| `contact_id` | b | string | Req | Target contact. |
| `type` | b | enum | Req | `call`, `outreach_manual_email`, `linkedin_step_connect`, `linkedin_step_message`, `linkedin_step_view_profile`, `linkedin_step_interact_post`, `action_item`. |
| `priority` | b | `high` \| `medium` \| `low` | | Priority. |
| `status` | b | string | Req | `scheduled` (future) or `completed` / `skipped`. |
| `due_at` | b | ISO datetime | Req | Due time (GMT). |
| `title` | b | string | | Title (auto-generated if omitted). |
| `note` | b | string | | Description. |

#### 11.4 Bulk Create Tasks — `POST /tasks/bulk_create`
One task per contact in `contact_ids`; same fields as 11.3 otherwise (no `title`).
- **Auth:** key `api/v1/tasks/bulk_create` or master · OAuth `tasks_create`. 0 credits.
- **Response:** `success`, `tasks[]`.

#### 11.5 Complete a Task — `POST /tasks/{id}/complete`
Marks completed; returns `deleted: true` if task vanished; 422 if already completed/skipped.
- **Auth:** key `api/v1/tasks/complete` or master · OAuth `tasks_create`. 0 credits.
- **Response:** `task{}`, `contact`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Task. |
| `note` | b | string | | Completion note. |

#### 11.6 Update a Task — `PATCH /tasks/{id}`
Scheduled tasks: all fields editable. Completed/skipped: only `note`, `priority`, `priority_cd`, `contact_id`.
- **Auth:** key `api/v1/tasks/update` or master · OAuth `tasks_create`. 0 credits.
- **Response:** `task{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Task. |
| `user_id`, `creator_id`, `contact_id`, `note`, `type`, `priority`, `priority_cd`, `status`, `due_at`, `title` | b | various | | Editable fields. |
| `call_script` | b | string | | Talking points for call tasks. |
| `relevant_fields` | b | string[] | | Team field names to surface on the task. |

#### 11.7 Skip a Task — `POST /tasks/{id}/skip`
- **Auth:** key `api/v1/tasks/skip` or master · OAuth `tasks_create`. 0 credits.
- **Response:** `task{}`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Task. |
| `note` | b | string | | Skip reason. |
| `on_task_page` | b | boolean | | Reindex synchronously. |

### 12. Engage with Prospects — Conversations

#### 12.1 Search Conversations — `POST /conversations/search`
Lists recorded meetings/calls with summaries (no transcripts/recordings).
- **Auth:** key `api/v1/conversations/search` or master · OAuth `conversations_search`. 0 credits.
- **Response:** `pagination`, `breadcrumbs`, `num_fetch_result`, `playlist_clip_ids`, `conversations[]`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `page`, `num_fetch_result` | b | integer | | Pagination / max results. |
| `conversation_type` | b | `video_conference` \| `phone_call` | | Type. |
| `account_id`, `contact_ids`, `organization_ids` | b | string / string[] | | Related records. |
| `tag_ids`, `tracker_ids` | b | string[] | | Labels / keyword trackers. |
| `date_range` | b | object | | Date window. |
| `scorecard_template_id`, `scorecard_max_rating` | b | string / number | | Scorecard filters. |
| `sort_by_field` | b | string | | Sort. |
| `enforce_contact_boundary` | b | boolean | | Restrict to conversations visible to given contacts. |

#### 12.2 Get Conversations Info — `GET /conversations/{id}`
- **Auth:** key `api/v1/conversations/show` or master · OAuth `conversations_show`.
- **Credits:** 1 credit if the conversation has AI insights, else 0.
- **Response:** `id`, `topic`, `start_time`, `duration`, `state`, `host`, `host_id`, `is_private`, `pushed_to_crm`, `account_ids`, `label_id_names`, `opportunity_ids`, `conversation_type`, `video_recording`, `audio_recording`, `transcript`, `participants`, `opportunities`, `comment_count`, ...

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `id` | p | string | Req | Conversation ID (optionally `id_shareid`). |

#### 12.3 Export Conversations — `POST /conversations/export`
Async gzipped-JSON export for a time range; emails a team member when ready.
- **Auth:** key `api/v1/conversations/export` or master · OAuth `conversations_export`. 0–1 credit per conversation. Free plan: 1/min, 20/hr.
- **Response:** `export_url`, `export_id`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `start_time`, `end_time` | b | ISO datetime | Req | Range (GMT). |
| `email` | b | string | Req | Team member to notify. |

#### 12.4 Get Conversations Export — `GET /conversations/export/{id}`
- **Auth:** key `api/v1/conversations/find_export` or master · OAuth `conversations_find_export`. 0 credits.
- **Response:** `redirect_url`.

### 13. AI Assistant

#### 13.1 Run an Assistant Task — `POST /agents/task`
Single endpoint to create, poll, and continue a conversational AI Assistant task (distinct from CRM tasks). Acceptance ≠ completion; poll with `task_id`.
- **Auth:** key `api/v1/agents/task` or master · OAuth `agent_task`. Assistant acts with the key user's permissions (endpoint restrictions on the key do not limit Assistant actions).
- **Credits:** variable, depending on actions the Assistant takes (e.g. enrichment); polling is free.
- **Response:** `task_id`, `status`, `next_action`, `messages[]`, `latest_seq_num`, `error_type`, `question`, `note`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `instruction` | b | string | Req to create | Instruction or follow-up answer; omit when polling. |
| `task_id` | b | string | | Existing task to poll/continue. |
| `since_seq_num` | b | integer | | Message cursor for incremental polling. |

### 14. Manage Apollo Workspace — Users & Email Accounts

#### 14.1 Get a List of Users — `GET /users/search`
- **Auth:** key `api/v1/users/search` or master (docs elsewhere state master key needed) · OAuth `users_list`. 0 credits.
- **Response:** `pagination`, `users[]`, `num_fetch_result`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `page`, `per_page` | q | integer | | Pagination. |

#### 14.2 Get Current User Profile — `GET /users/api_profile`
Profile of the acting user; optionally includes credit usage.
- **Auth:** key `api/v1/users/api_profile` or master · OAuth `read_user_profile` (granted by default). 0 credits.
- **Response:** `id`, `team_id`, `first_name`, `last_name`, `title`, `email`, plus (with flag) `num_credits_remaining`, `effective_num_*_credits`, `num_*_credits_used` for lead / direct dial / export / AI / power-up credits, `total_unified_credits_used`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `include_credit_usage` | q | boolean | | Include credit balances. |

#### 14.3 Get a List of Email Accounts — `GET /email_accounts`
Linked mailboxes; IDs are used for sequence enrollment.
- **Auth:** key `api/v1/email_accounts/index` or master · OAuth `email_accounts_list`. 0 credits. No params.
- **Response:** `email_accounts[]`.

### 15. Manage Apollo Workspace — Fields

#### 15.1 Get a List of Fields — `GET /fields`
- **Auth:** key `api/v1/fields/index` or master · OAuth `custom_fields_list`. 0 credits.
- **Response:** `fields[]` (`id`, `label`, `modality`, `context`, `type`, `source`, `project_workspace_id`, `meta`, `created_at`, `updated_at`).

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `source` | q | `system` \| `custom` \| `crm_synced` | | Filter by field origin. |

#### 15.2 Create a Custom Field — `POST /fields`
- **Auth:** key `api/v1/fields/create` or master · OAuth `custom_field_write`. 0 credits.
- **Response:** `typed_custom_fields`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `label` | b | string | | Field name. |
| `modality` | b | `contact` \| `account` \| `opportunity` | | Owning record type. |
| `type` | b | `string` \| `textarea` \| `number` \| `date` \| `datetime` \| `boolean` | | Data type. |
| `meta` | b | object | | Type config, e.g. `max_length`. |

#### 15.3 Update a Custom Field — `PATCH /fields`
Updates custom fields only (system/JSON-child fields immutable); one field per request recommended; `modality`/`type` are read-only.
- **Auth:** key `api/v1/fields/update` or master · OAuth `custom_field_write`. 0 credits.
- **Response:** `fields`, `typed_custom_fields`, `field_groups`, `picklist_value_sets`, `finder_views`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `fields[]` | b | object[] | Req | Each: `id` (`modality.field_id`), `label`, `field_group_id`, `autorun_downstream_enrichment`, `schedule`, `meta` (e.g. picklist values, max length). |

#### 15.4 Get a List of All Custom Fields — `GET /typed_custom_fields` (deprecated)
Superseded by `GET /fields?source=custom`.
- **Auth:** key `api/v1/typed_custom_fields/index` or master · OAuth `custom_fields_list`. 0 credits.
- **Response:** `typed_custom_fields[]`.

### 16. Analyze Performance

#### 16.1 Query Analytics Report — `POST /reports/sync_report`
Aggregated activity analytics (same engine as Apollo dashboards). Modes: flat totals, grouped by one dimension, or pivot (one row + one column dimension).
- **Auth:** key `api/v1/reports/sync_report` or master · OAuth `report_sync`. 0 credits. **5 requests/hour.**
- **Response:** `response`, `incompatible_filters`, `goals`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `metrics[]` | b | object[] | Req | `{value, smart_datetime_reference, smart_user_id_reference, display_name}`; metric families: email, phone, meeting, task, contact, account, opportunity, conversation intelligence, custom. |
| `group_by[]` | b | object[] | Req | ≤1 row dimension (`[]` for flat). |
| `pivot_group_by[]` | b | object[] | | ≤1 column dimension. |
| `sorts[]` | b | object[] | Req | First entry applied. |
| `filters` | b | object | Req | Key/value filters (`{}` for none); custom range via `smart_datetime_range{min,max}`. |
| `group_by_totals_selected`, `pivot_group_by_totals_selected` | b | boolean | Req | Include totals row/column. |
| `date_ranges[]` | b | object[] | Req | `{modality}` preset: today, yesterday, current_week/month/quarter/year, last_7_days, ..., custom_range. |
| `skip_group_by_values` | b | string[] | | Exclude dimension values. |
| `min_ratio_denominator` | b | integer | | Minimum denominator for ratio metrics. |

A companion page, **Metrics and Dimensions Reference** (`/reference/sync-report-metrics`), lists valid metric names, smart reference columns, group-by dimensions, filters, and date presets (~280 table rows). It is reference material, not an endpoint.

### 17. Usage and Webhooks

#### 17.1 View API Usage Stats and Rate Limits — `POST /usage_stats/api_usage_stats`
Per-endpoint usage counts and minute/hour/day limits for the team.
- **Auth:** key `api/v1/usage_stats/api_usage_stats` or master · OAuth `api_usage_stats_read`. 0 credits. No params.
- **Response:** object keyed by endpoint with per-window limit/usage (shape not formally specified).

#### 17.2 View Credit Usage Stats — `POST /usage_stats/credit_usage_stats`
Team credit balances per credit type for the current billing cycle.
- **Auth:** key `api/v1/usage_stats/credit_usage_stats` or master · OAuth `credit_usage_stats_read`. 0 credits. No params.
- **Response:** `credit_usage_stats` (per type: `limit`, `consumed`, `left_over`), `current_credit_cycle` (start/end).

#### 17.3 Poll Webhook Result — `GET /webhook_result/{request_id}`
Fetches the payload of an async enrichment webhook (retained 30 days). Returns 404 `result_pending` with `retry_after_seconds` while processing, 410 when expired.
- **Auth:** key `api/v1/webhook_result/show` or master · OAuth `webhook_result_read`. 0 credits.
- **Response:** `request_id`, `webhook_status`, `request_type`, `last_dispatched_at`, `failure_reason`, `webhook_result`.

| Param | In | Type | Req | Meaning |
| --- | --- | --- | --- | --- |
| `request_id` | p | int64 | Req | From people (bulk) enrichment response; may be negative. |

---

## Mapping notes for AnhourLeads

Observed resource model and the fields worth modeling. Field lists are drawn from documented response schemas/examples; trim CRM-sync and UI-preference fields we do not need.

### Core distinction: database vs. saved records
Apollo separates a **global data layer** (Person, Organization — searchable/enrichable, credit-metered) from a **team CRM layer** (Contact, Account — owned, staged, listed, sequenced). A Contact may reference a `person_id`; an Account references an `organization_id`. AnhourLeads should keep this two-layer split: a shared `person`/`organization` store populated by enrichment providers, and team-scoped `contact`/`account` records linked to it.

### Person (database)
`id`, `first_name`, `last_name`, `name`, `title`, `headline`, `seniority`, `departments[]`, `subdepartments[]`, `functions[]`, `email`, `email_status`, `extrapolated_email_confidence`, `linkedin_url`, `twitter_url`, `github_url`, `facebook_url`, `photo_url`, `city`, `state`, `country`, `organization_id`, `organization{}`, `employment_history[]` (title, organization, start/end, current), `contact_id` (if saved), `revealed_for_current_team`, `is_likely_to_engage`, `last_refreshed_at`. Search results expose a reduced, obfuscated variant (`last_name_obfuscated`, `has_email`, `has_direct_phone`, ...).

### Organization (database)
`id`, `name`, `website_url`, `primary_domain`, `linkedin_url`, `linkedin_uid`, `twitter_url`, `facebook_url`, `logo_url`, `primary_phone{}`, `founded_year`, `industry`, `industries[]`, `secondary_industries[]`, `keywords[]`, `estimated_num_employees`, `departmental_head_count{}`, `organization_headcount_{six,twelve,twenty_four}_month_growth`, `annual_revenue`, `total_funding`, `latest_funding_stage`, `latest_funding_round_date`, `funding_events[]`, `technology_names[]`, `current_technologies[]`, `raw_address`, `street_address`, `city`, `state`, `postal_code`, `country`, `short_description`, `seo_description`, `publicly_traded_symbol/exchange`, `languages[]`, `retail_location_count`, hierarchy (`owned_by_organization_id`, `owned_by_chain[]`, `ultimate_parent_organization`, `suborganizations[]`), `account_id` (if saved). Related: **JobPosting** (`id`, `title`, `url`, `city`, `state`, `country`, `posted_at`, `last_seen_at`) and **NewsArticle** (`id`, `url`, `domain`, `title`, `snippet`, `organization_ids[]`, `published_at`, `event_categories[]`).

### Contact (saved person)
`id`, `team_id`, `person_id`, `first_name`, `last_name`, `name`, `title`, `headline`, `email`, `email_status`, `email_source`, `email_unsubscribed`, `contact_emails[]`, `phone_numbers[]` (typed: direct, corporate, mobile, home, other), `linkedin_url`, `twitter_url`, `photo_url`, `present_raw_address`, `organization_name`, `organization_id`, `account_id`, `owner_id`, `creator_id`, `contact_stage_id`, `label_ids[]`, `emailer_campaign_ids[]`, `contact_campaign_statuses[]`, `source`, `original_source`, `last_activity_date`, `typed_custom_fields{}`, `existence_level`, external CRM IDs (`salesforce_*`, `hubspot_vid`, `crm_id`), `created_at`, `updated_at`. Supports dedupe-on-create semantics (by email/CRM ID).

### Account (saved company)
All Organization firmographic fields plus: `team_id`, `organization_id`, `domain`, `owner_id`, `creator_id`, `account_stage_id`, `label_ids[]`, `phone`, `phone_status`, `sanitized_phone`, `source`, `original_source`, `num_contacts`, `last_activity_date`, `typed_custom_fields{}`, `contact_emailer_campaign_ids[]`, `contact_campaign_status_tally{}`, `existence_level`, CRM IDs, `created_at`.

### Stage entities
- **ContactStage / AccountStage:** `id`, `team_id`, `name`, `display_name`, `display_order`, `category`, `is_meeting_set`, `default_exclude_for_leadgen`.
- **OpportunityStage:** `id`, `team_id`, `name`, `display_order`, `opportunity_pipeline_id`, `probability`, `forecast_category_cd`, `is_won`, `is_closed`, `is_meeting_set`, `type`, `description`. Implies a **Pipeline** entity.

### Sequence (emailer_campaign)
`id`, `name`, `user_id` (owner), `active`, `archived`, `creation_type` (draft/new/ai_assistant), `emailer_schedule_id`, `folder_id`, `label_ids[]`, `max_emails_per_day`, behavior flags (`mark_finished_if_reply/click/interested`, `mark_paused_if_ooo`, `create_task_if_email_open` + threshold, `days_to_wait_before_mark_as_response`, `same_account_reply_delay_days`, `sequence_by_exact_daytime`, `ignore_apollo_global_email_bounce_list`), `excluded_account_stage_ids[]`, `excluded_contact_stage_ids[]`, `cc_emails`, `bcc_emails`, `sequence_ruleset_id`, `sharing_permission{}`, `num_steps`, aggregate stats (`unique_scheduled/delivered/bounced/opened/replied/clicked/unsubscribed/...`, `*_rate`), `last_used_at`, `created_at`.

### Sequence step / touch / template
- **SequenceStep (emailer_step):** `id`, `emailer_campaign_id`, `position`, `type` (auto_email, manual_email, call, action_item, linkedin_step_connect/message/view_profile/interact_post), `wait_time`, `wait_mode` (minute/hour/day), `exact_datetime`, `priority`, `note`, `max_emails_per_day`, `auto_skip_in_x_days`.
- **Touch (emailer_touch):** `id`, `emailer_step_id`, `emailer_template_id`, `status` (must be `approved` to send), `type`. Multiple touches per step = A/B variants.
- **Template (emailer_template):** `id`, `subject`, `body_html`.
- **Enrollment (contact × sequence):** status (active/paused/finished/removed/stopped), `auto_unpause_at`, sending `email_account_id`; events: added, paused, resumed, failed, finished, removed, replied (`occurred_at`, `step_position`, `reason`, `emailer_message_id`).
- **SendingSchedule (emailer_schedule):** `id`, `name`, `default`, `time_zone`, `schedule_hash` (weekly windows), `use_contacts_time_zone`, `skip_holidays`.

### Email message (emailer_message)
`id`, `user_id`, `contact_id`, `account_id`, `email_account_id`, `emailer_campaign_id`, `emailer_step_id`, `emailer_touch_id`, `type`, `status` (drafted, scheduled, completed/delivered, failed, ...), `subject`, `body_html`, `body_text`, `from_email`, `from_name`, `to_email`, `to_name`, `recipients[]`, `cc_emails[]`, `bcc_emails[]`, `attachment_ids[]`, `enable_tracking`, `open_tracking_enabled`, `click_tracking_enabled`, `due_at`, `completed_at`, `failed_at`, `failure_reason`, `not_sent_reason`, `bounce`, `spam_blocked`, `replied`, `reply_class`, `provider_message_id`, `provider_thread_id`, `created_at`.

### Email account (linked mailbox)
`id`, `user_id`, `email`, `aliases[]`, `type`/`provider_display_name`, `active`, `default`, `signature_html`, sending limits (`email_daily_threshold`, `max_outbound_emails_per_hour`, `seconds_delay_between_emails`), `deliverability_score{}`, warmup state (`mailwarming_*`, `true_warmup_*`), `active_campaigns_count`, `last_synced_at`, `revoked_at`, `inactive_reason`, `created_at`.

### Task
`id`, `user_id` (owner), `creator_id`, `completed_by_user_id`, `contact_id`, `account_id`, `opportunity_id`, `person_id`, `organization_id`, `emailer_campaign_id`, `type` (call, outreach_manual_email, linkedin_step_*, action_item), `priority` (high/medium/low), `status` (scheduled/completed/skipped), `title`, `note`, `call_script`, `due_at`, `completed_at`, `skipped_at`, `relevant_fields`, `created_from`, `created_at`.

### Deal (opportunity)
`id`, `team_id`, `name`, `owner_id`, `created_by_id`, `account_id`, `amount`, `currency{}`, `exchange_rate_code`, `amount_in_team_currency`, `opportunity_stage_id`, `opportunity_pipeline_id`, `stage_name`, `stage_updated_at`, `is_closed`, `is_won`, `closed_date` (expected), `actual_close_date`, `closed_won_reason`, `closed_lost_reason`, `probability`/`deal_probability`, `forecast_category`, `forecasted_revenue`, `next_step`, `next_step_date`, `description`, `source`, `deal_source`, `opportunity_contact_roles[]`, `num_contacts`, `last_activity_date`, `typed_custom_fields{}`, `created_at`.

### List / label
`id`, `team_id`, `user_id`, `name`, `modality` (contacts | accounts; sequences also carry labels), `cached_count`, `book_of_business`, `created_at`, `updated_at`. Membership is many-to-many via `label_ids[]` on records; API manipulates membership by list **name** and auto-creates lists.

### Custom field
`id` (`modality.field_id`), `label`, `modality` (contact | account | opportunity), `type` (string, textarea, number, date, datetime, boolean; picklists via `meta`), `source` (system | custom | crm_synced), `context`, `field_group_id`, `meta{}` (e.g. `max_length`, picklist values), `created_at`, `updated_at`. Values stored on records as `typed_custom_fields{field_id: value}`.

### User
`id`, `team_id`, `first_name`, `last_name`, `name`, `title`, `email`, `permission_set_id`, `subteam_ids[]`, `deleted`, credit limits (`credit_limit`, `direct_dial_credit_limit`, `export_credit_limit`, `ai_credit_limit`), tracking prefs (`enable_open_tracking`, `enable_click_tracking`, `should_include_unsubscribe_link`), `created_at`. Plus team-level credit usage (`limit`, `consumed`, `left_over` per credit type; billing cycle).

### Other entities worth modeling
- **Note:** `id`, `user_id`, `content`, polymorphic links (`contact_ids`, `account_ids`, `opportunity_ids`, `conversation_ids`, `calendar_event_ids`), `pinned_to_top`, `system`, timestamps.
- **PhoneCall:** `id`, `user_id`, `contact_id`, `account_id`, `opportunity_id`, `inbound`, `from_number`, `to_number`, `status`, `start_time`, `end_time`, `duration`, `phone_call_purpose_id`, `phone_call_outcome_id` (team-defined lookup tables), `note`, `recording_url`, `logged`, `outreach_task_id`, `transcribed`.
- **Conversation (meeting recording):** `id`, `topic`, `conversation_type`, `start_time`, `duration`, `state`, `host_id`, `participants[]`, `account_ids`, `opportunity_ids`, `transcript`, `video_recording`, `audio_recording`, `is_private`.
- **Async job:** `entity_progress_job` for bulk updates/list ops; `request_id` + webhook/poll for enrichment.
- **API usage / rate limit counters** per team per endpoint (minute/hour/day) and **credit ledger** per credit type (lead, direct dial, export, AI, power-up).

### API design takeaways
1. Keep resource naming user-facing (`/sequences`, `/deals`, `/lists`) but consider aliases for Apollo's legacy paths (`/emailer_campaigns`, `/opportunities`, `/labels`, `/mixed_people/api_search`) if drop-in compatibility is a goal.
2. Support both per-endpoint scoped API keys and a master key; record an acting user per request.
3. Implement shared bulk patterns: create ≤100 with `run_dedupe` returning `created_*`/`existing_*`; update ≤1,000 with ids-mode vs attributes-mode and async jobs.
4. Adopt a single structured error envelope (`error_details.code` = `DOMAIN.CATEGORY.REASON`) from the start, plus rate-limit headers.
5. Model enrichment as async-capable with webhooks and a poll endpoint, and meter it through a credit ledger.
