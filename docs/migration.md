# Database migrations

Every file in `drizzle/` with what it changes and how safe it is to roll back (CLAUDE.md rule 10). Production applies migrations when the app container starts (`scripts/docker-entrypoint.mjs`); locally run `npm run db:migrate`.

**Rollback levels:** **Safe**: additive only; older code ignores it. **Caution**: additive, but older code may meet data it doesn't understand. **Breaking**: drops or renames; needs a data plan before rolling back.

| # | Migration | Date | Summary | Rollback |
| --- | --- | --- | --- | --- |
| 0000 | `0000_init.sql` | 2026-10-10 | Initial schema | n/a (first) |
| 0001 | `0001_mailbox_smtp_outbound.sql` | 2026-10-10 | Mailbox SMTP settings, outbound message log | Safe |
| 0002 | `0002_apollo_parity.sql` | 2026-10-11 | Tables and columns for the Apollo-parity screens | Caution |
| 0003 | `0003_discovery_index.sql` | 2026-10-11 | Installation-wide discovery index and crawler fleet | Safe |
| 0004 | `0004_data_sources.sql` | 2026-10-11 | Registry ids, person LinkedIn URL and source, workspace data providers | Safe |

## 0000_init

Creates every table:

- **Better Auth:** `user` (with admin-plugin `role`, `banned`, `ban_reason`, `ban_expires`), `session` (with `active_organization_id`, `impersonated_by`), `account`, `verification`, `organization` (workspace, with white-label `brand_name`, `brand_color`, `support_email`, `hostname_limit`), `member`, `invitation`.
- **White-label:** `workspace_domain` (hostname, status pending / verified / failing, verification token, routing, certificate status, timestamps).
- **Platform:** `api_key` (SHA-256 hash only), `audit_log`, `suppression` (unique per workspace, kind and value).
- **Prospecting:** `company`, `contact` (unique email per workspace), `field_provenance`, `list`, `list_member`.
- **Engagement:** `mailbox`, `sequence`, `sequence_step`, `enrollment` (unique per sequence and contact).
- **Pipeline:** `task`, `deal`.
- **Research:** `crawl_job`, `crawl_page`.

## 0001_mailbox_smtp_outbound

- `mailbox`: adds `smtp_host`, `smtp_port`, `smtp_secure` (default `starttls`), `smtp_user`, `smtp_password_enc` (AES-256-GCM, `src/server/crypto/secrets.ts`), `postal_address`.
- `company.annual_revenue`: integer → bigint (values above 2.1 billion).
- New table `outbound_message`: every email sent or held for review (status pending_review / queued / sent / failed / bounced / blocked, blocked reason, provider message id, timestamps), indexed by workspace and by mailbox + sent time for daily limits.
- Rollback: Safe. Dropping the new columns and table loses stored SMTP settings and send history only.

## 0002_apollo_parity

- New tables: `saved_search`, `saved_view`, `note`, `activity` (record timeline), `custom_field`, `persona`, `record_stage` (stage labels and protection), `stage_trigger`, `pipeline`, `pipeline_stage`, `sending_schedule`, `step_variant`, `email_template`, `snippet`, `workflow`, `workflow_run`, `notification`, `onboarding_state`, `sending_policy`, `sending_domain`, `enrichment_job`, `dashboard`, `ai_context`, `ai_chat`, `ai_message`.
- `company`: `last_activity_at`, `custom_fields` (jsonb). `contact`: `persona_id`, `last_activity_at`, `custom_fields`; stage values `bad_data`, `changed_job` added.
- `mailbox`: `signature`, `warmup_started_at`. `sequence`: `description`, `tags`, `owner_id`, `starred`, `schedule_id`, `cc`, `bcc`, `max_per_24h`, `ruleset` (jsonb). `sequence_step`: `wait_minutes`, `enabled`, `thread_mode`; LinkedIn step types. `outbound_message`: `variant_id`. `task`: `deal_id`, `enrollment_id`; LinkedIn task types. `deal`: `pipeline_id`, `stage_id`, `custom_fields`.
- Rollback: **Caution.** Additive, but older code doesn't know the new stage, step and task values (`bad_data`, `changed_job`, `linkedin_*`) that rows may now hold.

## 0003_discovery_index

- New tables: `index_company`, `index_person`, `index_job_posting`, `index_news` (installation-wide index built from public sources), `crawl_host` (politeness and robots.txt cache), `crawl_frontier` (URL queue), `seed_source`, `index_optout` (opt-outs and removal requests).
- Rollback: Safe. Dropping them loses the crawled index only; workspace data is untouched.

## 0004_data_sources

- `index_company`: `companies_house_number`, `sec_cik` (both unique, nullable): official registry ids.
- `index_person`: `linkedin_url` (a profile link published next to the person; the profile itself is never fetched), `source` (`crawl` default, `companies_house`, `sec_edgar`).
- New table `data_provider`: a workspace's own key for People Data Labs, Apollo or Hunter (AES-256-GCM, unique per workspace and provider).
- Seed source kinds `companies_house` and `sec_edgar` (text enum, no DDL).
- Rollback: Safe. Dropping the columns and table loses registry ids, stored LinkedIn links and saved provider keys only.
