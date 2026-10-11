# Browser extension: save person

`extension/` is a Manifest V3 extension for Chrome and Edge. While a user looks at one person's page in their own browser, a click on the toolbar button reads that page, lets them review the details and saves that one person into **their own workspace** through the public API. Install and day-to-day use: [extension/README.md](../extension/README.md).

## Product boundary

This is deliberate and must not be relaxed:

| The extension does | The extension never does |
| --- | --- |
| Run when the user clicks the toolbar button | Content scripts, background pages, timers or anything that runs on its own |
| Read the DOM already loaded in the active tab, once | Scroll, click, page through, open other tabs or profiles, follow links |
| Return at most one person per page | Read search results, lists, team pages without a main person, or anything in bulk |
| Prefill a form the user reviews and edits | Save without the user pressing Save |
| Save into the user's workspace by API key | Write to the shared discovery index |
| Talk only to the configured server | Call LinkedIn or any site's API (no voyager endpoints), use any site's cookies |

The user is responsible for each website's terms and for having a basis to keep the details they save (README, "Your responsibility").

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Temporary access to the tab the user clicked on, and only that tab. No standing access to any site. |
| `scripting` | `chrome.scripting.executeScript({ func: readPerson })` into that tab, once per popup open. |
| `storage` | The server URL and API key, in `chrome.storage.local`. |
| `optional_host_permissions: http(s)://*/*` | Declared so the options page can request access to **one** origin at runtime: the server the user configures (`chrome.permissions.request`, from the Save click). Nothing else is ever requested; Remove key drops it. |

No `host_permissions`, no `<all_urls>`, no `tabs`, no `cookies`, no `webRequest`, no content scripts.

## Reading a page

`extension/reader.js` exports `readPerson(document, location)`, a pure, self-contained function (it is serialised into the tab, so it references nothing outside itself). In order:

1. **JSON-LD**: `Person` nodes (including `@graph`, `ProfilePage.mainEntity`, `worksFor`, `address`, `sameAs`). A `ProfilePage` main person wins; otherwise exactly one person is required. Several people with no main one → `null`.
2. **Microdata**: exactly one `itemtype=schema.org/Person` scope.
3. **LinkedIn profile pages** (`linkedin.com/in/<slug>` only; any other LinkedIn path returns `null`): the single `h1` in `main`, the headline under it (title, and "at Company"), the current-company button's label, the location line, and the canonical `https://www.linkedin.com/in/<slug>` URL. A page with several headings returns `null`.
4. **OpenGraph** `og:type=profile` (`profile:first_name`, `profile:last_name`).

An email is taken only from structured data or a single `mailto:` link in the profile card. Non-http(s) pages return `null`.

## Saving

All calls send `X-Api-Key` with `credentials: "omit"`:

1. `GET /api/v1/users/api_profile`: workspace name, role and permissions (the popup hides Save without `contact:create` and says "Your role can't add contacts").
2. `POST /api/v1/contacts/search` with `name` (and `q` = email when present): an exact LinkedIn URL match shows "Already saved" with a link; a name and company match shows a "may already be saved" note and Save stays available.
3. `GET /api/v1/labels?entityType=contact` (with `list:read` and `list:update`): static lists for "Add to list".
4. Company: `POST /api/v1/accounts/search` by domain, then by exact name; if none and the role has `company:create`, `POST /api/v1/accounts` with `runDedupe: true`.
5. `POST /api/v1/contacts` with the reviewed fields, `companyId`, the location split into city / state / country, `source: "browser_extension"` and `sourceUrl` (the page). A 409 (same email) links to the existing person.
6. `POST /api/v1/labels/add_entity_ids` when a list was picked.
7. The result links to `/dashboard/people/<id>` on the configured server.

`contactCreateSchema` accepts `source` (only `"browser_extension"`) and `sourceUrl` (http or https URL) on single creates. The contact's `source` column takes the value, and every provenance row written for the create carries the source and `source_url`. Bulk create and CSV import ignore both. Permissions are unchanged (`contact:create`).

## Authentication, CORS and CSRF

- The extension uses a **workspace API key** (Settings → API keys, shown once, stored hashed). `route()` resolves it as an `apiKey` actor with the key's role, scoped to its workspace. Revoked or unknown keys get 401; the popup says so in plain words.
- Extension pages that hold the host permission for an origin are exempt from CORS, so the server needs **no CORS headers**.
- The CSRF check in `route()` applies only to cookie-authenticated (`user`) writes. Key requests skip it by design, and the extension never sends cookies, so the check is not loosened.
- The server URL must be https, or http on a local host (`localhost`, `*.localhost`, `127.0.0.1`), so a key never crosses the internet in clear text. A workspace hostname works the same as the installation's own host, because keys are workspace-scoped.

## Tests

- `tests/api/extension-reader.spec.ts`: the reader on synthetic markup only (a LinkedIn-like profile, a LinkedIn-like search results page, a JSON-LD bio page with a team list, a JSON-LD team page, microdata, OpenGraph, non-web URLs), injected as a standalone function like the popup does; then the popup's API flow with member and viewer keys, Globex isolation, and every role's key against `contact:create`.
- `tests/api/contacts.spec.ts`: `source` / `sourceUrl` on `POST /contacts` for every role, and 422s for other sources or non-http URLs.
- `tests/api/extension-browser.spec.ts`: loads the unpacked extension in Playwright Chromium (headless, `channel: "chromium"`), configures the options page with a real key, opens the popup as a page with `?tabId=` (a toolbar click can't be automated) against a local fixture page, edits a field, picks a list, saves, checks the record and its provenance through the API, and reopens the popup to see "Already saved". The test copy of the manifest lists the local origins as `host_permissions` because the runtime permission prompt can't be accepted in automation; the shipped manifest keeps them optional.
