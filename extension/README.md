# Save person (browser extension)

A small Chrome / Edge extension (Manifest V3) that saves **the one person on the page you are looking at** into **your own workspace**, after you review the details. Plain JavaScript, no build step.

More detail, including how it authenticates: [docs/browser-extension.md](../docs/browser-extension.md).

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `extension/` folder.
3. Pin "AnhourLeads — save person" to the toolbar.

## Configure

1. In the app, open **Settings → API keys** and create a key. Its role decides what the extension may do: member or above can save people; a viewer key can only look.
2. Open the extension's options (right-click the toolbar button → Options).
3. Enter the **server URL**, the address you sign in at, for example `https://acme.example.com` (or `http://acme.localhost:3410` locally; plain `http` is accepted only for local hosts).
4. Paste the **API key** and click **Save and test connection**. Chrome asks once for access to that one server; allow it. The page then shows the workspace and role the key belongs to.

The key is kept in `chrome.storage.local` in this browser profile only. **Remove key** deletes it and drops the server access.

## Use

Open a person's page (a LinkedIn profile, or a team or bio page on a company website) and click the toolbar button. The popup:

1. reads the page once (structured data first: JSON-LD, microdata, OpenGraph; then the visible name, headline, current company and location on a `linkedin.com/in/…` profile);
2. shows the details in a form you can edit;
3. checks your workspace for the same person (same LinkedIn URL, or same name and company) and links to it if found;
4. saves with **Save to &lt;workspace&gt;**, optionally adding the person to a static list, and links to the new record.

The record's source is `browser_extension`, and every field's provenance keeps the page URL.

## What it does not do

- It never runs on its own: no content scripts, no background page, nothing until you click the button.
- It has no standing access to any website. `activeTab` lets it read only the tab you clicked on, once. The only host access it asks for is your own server.
- It reads only what is already loaded in that tab. It never scrolls, clicks, opens other profiles or pages, follows links, or reads search results or lists of people. One page gives at most one person; pages that list several people give none.
- It never calls LinkedIn's (or any site's) APIs and never uses your cookies for any site, including your AnhourLeads session. It talks only to your server, with the API key.
- It saves only into your own workspace. Nothing goes into the installation's shared discovery index.

## Your responsibility

You decide whom you save and from where. Each website has its own terms of use, and the people you save have rights under data protection law (for example the GDPR or CCPA). Make sure you are allowed to keep and use the details you save, and record a legal basis in the person's consent field where your workspace needs one.

## Development

- `reader.js` exports `readPerson(document, location)`. It is injected into the tab as a single function, so it must stay self-contained (no imports, no references outside the function).
- `api.js` holds settings and API calls; `popup.js` and `options.js` are the two pages; `styles.css` follows BRANDING.md.
- Tests: `tests/api/extension-reader.spec.ts` (reader on synthetic markup, the API flow by key) and `tests/api/extension-browser.spec.ts` (the unpacked extension in Chromium). Run with `npx playwright test --project=api tests/api/extension-`.
