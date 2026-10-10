# Database migrations

Every file in `drizzle/` with what it changes and how safe it is to roll back (CLAUDE.md rule 10). Production applies migrations when the app container starts (`scripts/docker-entrypoint.mjs`); locally run `npm run db:migrate`.

**Rollback levels:** **Safe**: additive only; older code ignores it. **Caution**: additive, but older code may meet data it doesn't understand. **Breaking**: drops or renames; needs a data plan before rolling back.

| # | Migration | Date | Summary | Rollback |
| --- | --- | --- | --- | --- |
| 0000 | `0000_init.sql` | 2026-10-10 | Initial schema | n/a (first) |
| 0001 | `0001_mailbox_smtp_outbound.sql` | 2026-10-10 | Mailbox SMTP settings, outbound message log | Safe |

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
