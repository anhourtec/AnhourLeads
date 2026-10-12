# White-label hostnames, verification and HTTPS

How a workspace gets its own web address (for example `portal.acme.com`) that shows its brand, how AnhourLeads proves the workspace owns that name, and how HTTPS certificates are issued and watched.

Related: [deployment-guide.md](./deployment-guide.md) (server set-up), [roles.md](./roles.md) (who can do what), `BRANDING.md` (white-label rules).

---

## Overview

- **What a hostname does.** A request's hostname decides which brand is shown and who may sign in (`resolveTenant` in `src/server/tenancy/host.ts`). On a workspace hostname every page, title and email shows the workspace's brand and never "AnhourLeads"; only that workspace's members can sign in; sign-up is off. Unknown hostnames get 404 everywhere, including `/api/auth/**`.
- **Who manages them.** `domain:manage` (owners and administrators) adds, verifies and removes hostnames on **Settings → Domains** (`/dashboard/settings/domains`). `domain:read` (managers) sees the list, statuses and DNS records read-only. Everyone else gets a not-found page and 403 from the API.
- **How many.** Each workspace may have `organization.hostname_limit` custom hostnames (default 1). Platform administrators change it, 0–50, on **Platform** (`/dashboard/platform`). Lowering it removes nothing. Local development names don't count (separate cap of 10).
- **Why verify.** A hostname decides whose brand and whose users a URL serves, and it gets a publicly trusted certificate. Without proof of ownership, any workspace administrator could claim someone else's name. So a new public hostname does **nothing** until DNS proves the workspace controls it.

## Lifecycle

```
               add                proof found                proof gone
  (nothing) ───────▶ pending ───────────────────▶ verified ───────────────▶ failing
                       │   ▲                         ▲                         │
                       │   └── still no proof        └──── proof back ─────────┤
                       │       (stays pending,                                 │ 7 days
                       │        plain message shown)                           ▼
                       ├── remove ─▶ (gone)                         stops serving (like pending)
                       └── 7 days without proof ─▶ claim expires (removed)
```

| Status | Serves the brand, sign-in, `tls-ask`? | How it gets there |
| --- | --- | --- |
| **Pending** (neutral pill) | No: treated like an unknown host (404) | Every new public hostname |
| **Verified** (positive pill) | Yes | Verify now, or a background re-check, finds the TXT record |
| **Failing** (attention pill, "Switches off on …") | Yes, for a **7-day grace period** from `failing_since` (`FAILING_GRACE_MS`); afterwards it stops serving ("Switched off") | A re-check of a verified hostname no longer finds the TXT record |

- **Inconclusive DNS never changes state.** A timeout or server failure leaves the status as it was; only a definite "record not there" moves verified → failing.
- **Local development names** (`*.localhost`, or anything with a `:port`, e.g. `acme.localhost:3410`) can't be proven through public DNS. They are **verified on add**, never re-checked and have no certificate ("Local development — no certificate"). When `APP_PROTOCOL=https` they are refused.
- **Unverified claims expire after 7 days**, so nobody can block a name with a pending hostname forever. An expired claim never blocks someone else adding the name.
- **Every status change** drops the hostname's tenant cache (`invalidateTenant`) and its auth instance (`dropAuth`), so it takes effect on the next request. Removing a hostname signs nobody out by itself, but every session on it stops working on the next request.
- **Audit:** `domain.add`, `domain.verify`, `domain.verify_failed` (manual checks only), `domain.failing`, `domain.switched_off`, `domain.expired`, `domain.remove`, and `domain.limit_update` (platform administrators, recorded in the target workspace). Background changes have no actor.

## Rules for hostnames

Checked by `parseHostname` in `src/server/domains/hostname.ts`; every failure is a 422 with a plain sentence.

- Lowercase letters, digits and hyphens in dot-separated labels (1–63 characters each, no leading or trailing hyphen), at least two labels, at most 253 characters. Stored lowercase.
- No trailing dot (`portal.acme.com.`), no scheme or path, no IP addresses, no all-numeric last label.
- A port only for local development names.
- **Reserved:** `APP_PRIMARY_HOSTS`, `APP_DOMAIN_TARGET` and their subdomains (local names like `localhost` excepted from the subdomain rule).
- **One workspace per hostname** (409 "That hostname is already in use.").
- **A subdomain is recommended.** A root domain (`acme.com`) is accepted, with a warning: most DNS providers don't allow a CNAME at the zone apex.

## DNS records

For each public hostname the workspace adds two records at its DNS provider. Settings → Domains shows both with copy buttons.

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| `CNAME` | `portal.acme.com` | `APP_DOMAIN_TARGET` (e.g. `leads.example.com`) | Routes visitors to this installation |
| `TXT` | `_anhour-verify.portal.acme.com` | `anhour-verify=<token>` | Proves ownership. Keep it in place: it is re-checked hourly |

- The token is 24 random bytes (32 base64url characters), generated server-side on add and never accepted from a client. Only people with `domain:read` in that workspace see it.
- Ownership is checked with a TXT lookup (`node:dns` `Resolver`, 3 s timeout, 2 tries; `src/server/domains/dns.ts`). DNS only: nothing connects to the hostname.
- **Routing is informational:** the CNAME (or matching A records) is looked up and shown as "Pointed at …". Verification only needs the TXT record, so a workspace can verify before moving traffic.
- **No file-upload proof.** Once the CNAME points here, a file served from the hostname is served by AnhourLeads itself, so it would prove nothing about who controls DNS.

## Checks and re-checks

| What | When | How |
| --- | --- | --- |
| Verify now | On demand, `domain:manage`; at most once per 10 s per hostname (429 otherwise) | `POST /api/v1/domains/{id}/verify` |
| Pending hostnames | Every 5 minutes until verified or the claim expires | `domainsJob` (`src/server/jobs/domains.ts`) in the scheduler |
| Verified / failing hostnames | At most hourly (TXT, CNAME and certificate) | same job |
| Expired claims | Every run | same job |

The job is safe to run concurrently (several scheduler replicas, or `npm run domains:recheck` by hand while the scheduler runs): every hostname is checked under its own Redis lock (`anhour:domain:lock:<hostname>`, 5 minutes).

**Certificate status** (`src/server/domains/cert-check.ts`) is read while a hostname serves: a TLS handshake on port 443 with SNI = hostname. With `APP_TLS_PROVIDER=nginx` the handshake goes to this installation's own address (`APP_DOMAIN_TARGET`), so "Active" means the certificate is installed **here**, not whatever a proxy in front shows; with `cloudflare` it goes to the hostname itself. The address is resolved first and the handshake goes only to a **public** address (never private, loopback, link-local/metadata, CGNAT or multicast). No HTTP request is made. Trusted and in date → Active; no answer → Waiting; untrusted, wrong name or expired → Problem. With `none` (local development) nothing is checked.

Settings → Domains shows four set-up steps per hostname: **Ownership verified → Pointed at the target → HTTPS certificate → Live**, each with its state in words.

## Providers

`APP_TLS_PROVIDER` says who issues certificates.

| Value | Use | Certificates |
| --- | --- | --- |
| `nginx` | Self-hosted production (NGINX + certbot, Let's Encrypt) | The certbot sync issues certificates for primary hosts and serving workspace hostnames within about 15 minutes of verification |
| `cloudflare` | Production behind Cloudflare | Cloudflare issues them at its edge (Cloudflare for SaaS custom hostnames); the origin serves a Cloudflare Origin CA certificate |
| `none` | Local development only | none |

Ownership is always proven with our TXT record, whichever provider is used.

### Cloudflare for SaaS (option)

Universal SSL only covers hostnames in **your own** Cloudflare zone. Workspace domains like `portal.acme.com` need **Cloudflare for SaaS → custom hostnames** (check current pricing and plan limits on cloudflare.com before relying on it).

1. Add your zone (e.g. `example.com`) to Cloudflare.
2. Create a proxied fallback origin record, e.g. `A leads-origin.example.com → <server address>`, and the CNAME target workspaces use, e.g. `CNAME leads.example.com → leads-origin.example.com` (proxied). Set `APP_DOMAIN_TARGET=leads.example.com`.
3. SSL/TLS → Custom Hostnames: enable Cloudflare for SaaS and set the fallback origin.
4. SSL/TLS → Origin Server → Create certificate for `example.com` and `*.example.com`. Save it as `deploy/certs/origin.pem` and the key as `deploy/certs/origin-key.pem` (`chmod 600`; never commit them, `deploy/certs/` is gitignored). Encryption mode **Full (strict)**, Always Use HTTPS on.
5. `deploy/.env`: `APP_TLS_PROVIDER=cloudflare`, `NGINX_CONF=cloudflare`, empty `COMPOSE_PROFILES`.
6. Firewall the origin so 80/443 accept only [Cloudflare's IP ranges](https://www.cloudflare.com/ips/), and/or enable Authenticated Origin Pulls (uncomment `ssl_client_certificate` / `ssl_verify_client` in `deploy/nginx/cloudflare.conf` after saving the origin-pull CA to `deploy/certs/cloudflare-origin-pull-ca.pem`).
7. For each verified workspace hostname, add it as a custom hostname in the Cloudflare dashboard (AnhourLeads doesn't call the Cloudflare API yet; see "Known limits" below).

## NGINX and certbot (self-hosted)

`deploy/docker-compose.prod.yml` runs **nginx** (`nginx:stable-alpine`) → **app** (`deploy/Dockerfile`, port 3410) → **postgres** + **redis**, plus **scheduler** and, with `COMPOSE_PROFILES=letsencrypt`, **certbot**. Only NGINX publishes ports (80 and 443).

| File | Role |
| --- | --- |
| `deploy/nginx/nginx.conf` | Workers, pid in `/run` (shared with certbot), Docker DNS resolver, body size, gzip, TLS 1.2/1.3, JSON logs, includes the mode file |
| `deploy/nginx/letsencrypt.conf` | Self-hosted mode (`NGINX_CONF=letsencrypt`) |
| `deploy/nginx/cloudflare.conf` | Behind Cloudflare (`NGINX_CONF=cloudflare`) |
| `deploy/nginx/snippets/proxy.conf`, `proxy-pass.conf` | Proxy to `app:3410`: forwarded headers, request id, timeouts; `/api/health*` not logged |
| `deploy/nginx/snippets/cloudflare-real-ip.conf` | Cloudflare's ranges + `real_ip_header CF-Connecting-IP` |
| `deploy/nginx/snippets/logging.conf` | JSON access log on stdout |
| `deploy/nginx/update-cloudflare-ips.sh` | Refreshes the Cloudflare ranges (validates every line, refuses a short list) |
| `deploy/nginx/sites/` (gitignored) | Per-hostname server blocks written by certbot |
| `deploy/certbot/` | certbot image (`Dockerfile`), `run.sh` (loop), `sync-certs.sh`, `reload-nginx.sh` |
| `deploy/certs/` (gitignored) | Cloudflare Origin CA certificate and key |

**What the app needs from the proxy.** Compose sets `APP_PROTOCOL=https` and `APP_TRUST_PROXY=true`, so the app reads the tenant from `X-Forwarded-Host`. NGINX therefore **overwrites** `X-Forwarded-For` (`$remote_addr`), `X-Forwarded-Proto`, `X-Forwarded-Host`, `Host` and `X-Real-IP` on every request; client-sent values are never passed on. Every Host is passed through: the app decides which workspace, or 404.

**letsencrypt.conf:** port 80 answers ACME challenges from the shared webroot and redirects everything else to HTTPS; port 443 has a `default_server` with `ssl_reject_handshake on` (a name without a certificate gets no certificate and no page) plus one generated block per hostname in `sites/`. Generated blocks also answer ACME challenges on 443 so renewals pass behind an HTTPS redirect.

**What certbot does** (`run.sh` → `sync-certs.sh`), at start and every `CERT_SYNC_INTERVAL` seconds (default 900):

1. **Wanted hostnames:** `APP_PRIMARY_HOSTS` (ports stripped) + workspace hostnames read from Postgres: `workspace_domain` with `status = 'verified'`, or `'failing'` with `failing_since` within 7 days, excluding `localhost`, `*.localhost` and ported names: the same rule as `resolveTenant` and `tls-ask`. Every name must pass a strict hostname pattern before it touches a file or NGINX config. If Postgres can't be read, nothing is changed.
2. **Certificates:** `certbot certonly --webroot` for wanted names without one (`--staging` with `ACME_STAGING=true`; staging certificates are replaced automatically once it's back to `false`). A failure is logged and retried after `CERT_RETRY_MINUTES` (60); it never blocks the others.
3. **Server blocks:** written for wanted names with a certificate; removed for names no longer wanted. Certificates are deleted only after `CERT_DELETE_AFTER_DAYS` (7) unwanted days.
4. **Reload:** `nginx -t && nginx -s reload` when anything changed; on a failed test the previous blocks are restored.
5. **Renewals:** `certbot renew --deploy-hook reload-nginx.sh` every `CERT_RENEW_INTERVAL` (12 h).

The certbot container is built from the same NGINX image, mounts the same config and shares nginx's PID namespace (`pid: service:nginx`) and `/run`, so `nginx -t` tests the exact configuration and `nginx -s reload` signals the running NGINX.

**Issue a certificate now:** `docker compose -f docker-compose.prod.yml exec certbot /opt/anhourleads/sync-certs.sh`.

### `GET /api/domains/tls-ask?domain=<host>`

Public, no session. **200** for the primary hosts (with or without port) and for workspace hostnames that serve right now; **404** for everything else (pending, unknown, past grace, invalid input). It's the HTTP form of the certbot rule: useful for operators, monitoring, and as the gate for a proxy with on-demand certificates. Cheap: `resolveTenant` is cached in Redis.

### Logs and request IDs

NGINX logs one JSON object per request on stdout (`docker compose logs nginx`): `time`, `request_id`, `remote_addr` (real client), `x_forwarded_for` (as received), `host`, `method`, `uri` (path only; tokens in invitation, password-reset and unsubscribe paths replaced by `[redacted]`), `args_present`, `status`, `body_bytes_sent`, `request_time`, `upstream_response_time`, `upstream_status`, `http_user_agent`, `http_referer` (no query, same redaction), `ssl_protocol`, `server_name`. Health probes are not logged.

NGINX ignores any client `X-Request-Id`, sends its own `$request_id` to the app and returns it in the response. The app's API access log line (`msg: "request"`) carries the same `requestId`: `docker compose -f docker-compose.prod.yml logs app | grep <request id>`.

## What workspace administrators do

1. **Settings → Domains → Add hostname**, e.g. `portal.acme.com`. It appears as **Pending** with a "Set up DNS" card.
2. Add the **CNAME** and **TXT** records shown (copy buttons) at the DNS provider.
3. **Verify now.** Found → **Verified**, the hostname shows the brand straight away. Not yet → it stays Pending with "No TXT record found at _anhour-verify.portal.acme.com yet. DNS changes can take up to an hour." The scheduler also checks every 5 minutes, so nobody has to keep the page open.
4. **HTTPS** follows automatically (self-hosted: within one certbot sync, about 15 minutes, once the CNAME points here).
5. **Keep both records.** Live hostnames are re-checked hourly. TXT gone → **Failing**, still serving for 7 days, then switched off; back in time → Verified again.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Stays Pending for over an hour | TXT added at the wrong name (many DNS panels append the domain, giving `_anhour-verify.portal.acme.com.acme.com`) | Enter only the part before the domain if the panel adds it, then Verify now |
| "The TXT record … doesn't match" | Value copied with quotes, spaces or truncated | Copy the value again with the copy button |
| "Couldn't look up DNS … right now" | Resolver timeout or failure | Nothing changed; try again in a few minutes |
| Pointed step says "Action needed" | CNAME missing or pointing elsewhere | Add or fix the CNAME. Verification works without it, but visitors won't reach the installation |
| Wants the root domain (`acme.com`) | CNAME isn't allowed at the zone apex at most providers | Use a subdomain (recommended), or a provider with ALIAS / CNAME flattening |
| HTTPS stays Waiting or shows a CAA problem | A CAA record doesn't allow Let's Encrypt (or Cloudflare's CA) | Add `0 issue "letsencrypt.org"` (or the CA in use), or remove the restrictive CAA |
| (Self-hosted) verified but still Waiting after 15 minutes | CNAME not pointing here yet, port 80 blocked, CAA, or Let's Encrypt rate limits | `docker compose -f docker-compose.prod.yml logs certbot`; fix the cause; retried 60 minutes after a failure, or run the sync by hand |
| (Self-hosted) certbot logs "couldn't read hostnames from Postgres" | Postgres down or `POSTGRES_*` changed | Fix the database; nothing changes while it fails |
| (Self-hosted) "nginx -t failed; restoring the previous server blocks" | Broken certificate file or a hand edit | `docker compose … exec nginx nginx -t`; remove the broken file or `certbot delete --cert-name <host>` |
| Browser shows a connection error (no certificate) | Hostname not serving (pending / past grace) or no certificate yet | Check its status on Settings → Domains and the certbot log |
| Cloudflare 525 on a workspace hostname | The workspace's record is proxied (orange cloud) in its own Cloudflare account | Set the record to DNS only (grey cloud) |
| Cloudflare 526 | Origin CA files missing or wrong | Recreate the Origin CA certificate, replace `deploy/certs/*.pem`, restart nginx |
| Cloudflare 521 / 522 | NGINX not running (waiting for the app's healthcheck) or firewall blocks Cloudflare | `docker compose … ps`, `logs app nginx`; allow Cloudflare's current ranges |
| Every user shows a Cloudflare address in logs | Ranges in `cloudflare-real-ip.conf` out of date | Run `deploy/nginx/update-cloudflare-ips.sh`, reload NGINX |
| NGINX won't start: `cannot load certificate "/etc/nginx/certs/origin.pem"` | `NGINX_CONF=cloudflare` without the Origin CA files | Add them, or use `NGINX_CONF=letsencrypt` |

## Local development

`APP_TLS_PROVIDER=none` (`.env.example`). `acme.localhost:3410` (seeded) and any `*.localhost:3410` name you add are verified on add; nothing is looked up or issued. A real-looking hostname (e.g. `portal.example.invalid`) stays Pending and Verify now shows the plain "No TXT record found…" message; the API tests rely on this.

## Testing

| What | How |
| --- | --- |
| Endpoints × roles, 401, CSRF, API keys, Globex isolation, validation, limits, rate limit, tls-ask, a local hostname serving the brand and 404 after removal | `tests/api/domains.spec.ts`, `tests/api/branding.spec.ts`, `tests/api/platform.spec.ts` |
| Screens per role and size, read-only manager view, gated 404s, white-label sign-in never showing "AnhourLeads" | `tests/ui/domains.spec.ts`, `tests/ui/branding.spec.ts`, `tests/ui/platform.spec.ts` |
| NGINX configs | `nginx -t` in `nginx:stable-alpine` for both modes with throwaway self-signed certificates |
| certbot sync | `sync-certs.sh` in the certbot image with stubbed `psql` / `certbot`: invalid names skipped, issue, failure back-off, idempotent second run, reload |
| Real Let's Encrypt issuance, real Cloudflare | Not automated: verify on a staging server (`ACME_STAGING=true` first) |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PRIMARY_HOSTS` | `localhost:3410,127.0.0.1:3410` | The installation's own hostnames (installation brand); certbot issues certificates for them; reserved |
| `APP_DOMAIN_TARGET` | first primary host without port | CNAME target shown to workspaces; reserved with its subdomains; the certificate check connects here with `nginx` |
| `APP_PROTOCOL` | `http` | `https` in production (compose sets it); local names are refused with `https` |
| `APP_TRUST_PROXY` | `false` | `true` behind NGINX (compose sets it): trust `X-Forwarded-Host/-For/-Proto` |
| `APP_TLS_PROVIDER` | `none` | `nginx`, `cloudflare` or `none` |
| `NGINX_CONF` | `letsencrypt` | Compose: `letsencrypt` or `cloudflare` |
| `COMPOSE_PROFILES` | — | Compose: `letsencrypt` starts certbot |
| `ACME_EMAIL` | — | Let's Encrypt account email |
| `ACME_STAGING` | `false` | `true` uses the staging CA (untrusted test certificates) |
| `CERT_SYNC_INTERVAL` | `900` | Seconds between certbot syncs |
| `CERT_RENEW_INTERVAL`, `CERT_RETRY_MINUTES`, `CERT_DELETE_AFTER_DAYS` | `43200`, `60`, `7` | Renewal cadence, retry back-off, delay before an unused certificate is deleted |

## Known limits

- The Cloudflare for SaaS custom hostnames are registered by hand in Cloudflare; AnhourLeads doesn't call the Cloudflare API.
- Certificate issuer and the reason for a certificate problem aren't stored (only `cert_status` and `cert_expires_at`); the screen shows a generic sentence.
- No notifications yet: status changes are audited and logged only.
- No uploaded (bought) certificates.

---

## Document history

| When (UTC) | Who | What |
| --- | --- | --- |
| 2026-10-10 | Anhourtec | Created: lifecycle, DNS records, providers, NGINX + certbot, Cloudflare option, troubleshooting, env vars |
