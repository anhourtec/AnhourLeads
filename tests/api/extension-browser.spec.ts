import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";

import { apiAsRole, BASE_URL } from "../support/session";
import { createKey, uniq } from "./admin-helpers";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * The unpacked extension in Chromium, end to end: options (server URL + API key, test connection),
 * then the popup reading a local bio page and saving the person into Acme.
 *
 * Two things a real user does by hand can't be automated, so the test stands in for them:
 *  - the toolbar click that grants activeTab: the popup is opened as a page with `?tabId=`;
 *  - the permission prompt for the server origin: a test copy of the manifest lists the local
 *    origins under `host_permissions`. The shipped manifest keeps them optional.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const SOURCE = path.resolve(__dirname, "../../extension");

/** Chromium derives an unpacked extension's id from its absolute path. */
function extensionId(dir: string): string {
  const hex = createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
}

let workDir = "";
let context: BrowserContext;
let id = "";
let server: http.Server;
let pageUrl = "";
const tag = uniq("ext");
const person = { first: "Ada", last: `Byron ${tag}`, title: "Chief Technology Officer" };

test.beforeAll(async () => {
  workDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "anhourleads-ext-")));
  const extDir = path.join(workDir, "extension");
  cpSync(SOURCE, extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(extDir, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*"];
  writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  id = extensionId(extDir);

  const html = `<!doctype html><html><head><title>${person.first} ${person.last}</title>
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      givenName: person.first,
      familyName: person.last,
      jobTitle: person.title,
      worksFor: { "@type": "Organization", name: `Northwind ${tag}`, url: `https://${tag}.example/` },
      address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "United Kingdom" },
      sameAs: [`https://www.linkedin.com/in/${tag}/`],
    },
  })}</script></head><body><h1>${person.first} ${person.last}</h1><p>${person.title}</p></body></html>`;
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/pricing" ? "<!doctype html><html><body><h1>Pricing</h1></body></html>" : html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/team/ada`;

  context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function tabIdOf(extensionPage: Page, url: string): Promise<number> {
  return extensionPage.evaluate(async (target) => {
    const ext = Reflect.get(globalThis, "chrome");
    const tabs: { id: number; url?: string }[] = await ext.tabs.query({});
    const tab = tabs.find((t) => t.url === target);
    if (!tab) throw new Error(`no tab for ${target}`);
    return tab.id;
  }, url);
}

test("configure, read the page, save into the workspace, then see it as already saved", async () => {
  const owner = await apiAsRole("owner");
  const { secret } = await createKey(owner, "member", uniq("extension"));
  const listName = `Extension ${tag}`;
  const list = await owner.post("/api/v1/labels", { data: { name: listName, entityType: "contact" } });
  expect(list.status(), await list.text()).toBe(201);
  const listId = (await list.json()).label.id;

  // Options: server URL + API key, then the connection test.
  const options = await context.newPage();
  const errors: string[] = [];
  options.on("pageerror", (e) => errors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel("Server URL").fill(BASE_URL);
  await options.getByLabel("API key").fill(secret);
  await options.getByRole("button", { name: "Save and test connection" }).click();
  await expect(options.getByRole("status")).toHaveText(/Connected to Acme Outbound as Member\./);

  // The page the user is looking at, and the popup reading it.
  const site = await context.newPage();
  await site.goto(pageUrl);
  const tabId = await tabIdOf(options, pageUrl);

  const popup = await context.newPage();
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
  await expect(popup.getByRole("heading", { name: "Acme Outbound" })).toBeVisible();
  await expect(popup.getByLabel("First name")).toHaveValue(person.first);
  await expect(popup.getByLabel("Last name")).toHaveValue(person.last);
  await expect(popup.getByLabel("Title")).toHaveValue(person.title);
  await expect(popup.getByLabel("Company", { exact: true })).toHaveValue(`Northwind ${tag}`);
  await expect(popup.getByLabel("Company domain")).toHaveValue(`${tag}.example`);
  await expect(popup.getByLabel("Location")).toHaveValue("London, United Kingdom");
  await expect(popup.getByLabel("LinkedIn URL")).toHaveValue(`https://www.linkedin.com/in/${tag}`);
  await popup.screenshot({ path: ".playwright-mcp/extension-01-popup-prefilled.png" });

  // The user edits a field before saving and picks a list.
  await popup.getByLabel("Title").fill("CTO");
  await popup.getByLabel("Add to list").selectOption({ label: listName });
  await popup.getByRole("button", { name: "Save to Acme Outbound" }).click();
  await expect(popup.getByRole("status")).toHaveText(`Saved to Acme Outbound. Added to ${listName}.`);
  const open = popup.getByRole("link", { name: "Open in Acme Outbound" });
  await expect(open).toBeVisible();
  const href = (await open.getAttribute("href")) ?? "";
  expect(href).toMatch(new RegExp(`^${BASE_URL}/dashboard/people/[^/]+$`));
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.screenshot({ path: ".playwright-mcp/extension-02-popup-saved-dark.png" });
  await popup.emulateMedia({ colorScheme: "light" });

  // The contact exists in the workspace, with the extension as its source and the page as provenance.
  const contactId = href.split("/").pop() ?? "";
  const contact = (await (await owner.get(`/api/v1/contacts/${contactId}`)).json()).contact;
  expect(contact).toMatchObject({
    firstName: person.first,
    lastName: person.last,
    title: "CTO",
    city: "London",
    country: "United Kingdom",
    linkedinUrl: `https://www.linkedin.com/in/${tag}`,
    source: "browser_extension",
    company: { name: `Northwind ${tag}` },
  });
  const prov = (await (await owner.get(`/api/v1/contacts/${contactId}/provenance`)).json()).provenance;
  expect(prov.find((p: { field: string }) => p.field === "title")).toMatchObject({
    source: "browser_extension",
    sourceUrl: pageUrl,
  });
  const members = await owner.get(`/api/v1/labels/${listId}/members?per_page=10`);
  expect(members.status(), await members.text()).toBe(200);
  expect(JSON.stringify(await members.json())).toContain(contactId);

  // Opening the popup again on the same page finds the saved person.
  await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
  await expect(popup.getByRole("status")).toHaveText("Already saved in Acme Outbound.");
  await expect(popup.getByRole("link", { name: "Open in Acme Outbound" })).toHaveAttribute("href", href);
  await expect(popup.getByRole("button", { name: /Save/ })).toBeHidden();

  expect(errors).toEqual([]);
});

test("a page with no single person, and a viewer key", async () => {
  const owner = await apiAsRole("owner");
  const pricing = new URL("/pricing", pageUrl).href;
  const site = await context.newPage();
  await site.goto(pricing);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const tabId = await tabIdOf(options, pricing);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
  await expect(popup.getByRole("status")).toHaveText(/No single person found on this page/);
  await expect(popup.locator("form")).toBeHidden();

  // A viewer key: the popup says the role can't add contacts.
  const { secret } = await createKey(owner, "viewer", uniq("extension-viewer"));
  await options.getByLabel("API key").fill(secret);
  await options.getByRole("button", { name: "Save and test connection" }).click();
  await expect(options.getByRole("status")).toHaveText(/This key's role can't add people/);
  const bio = await context.newPage();
  await bio.goto(pageUrl);
  const bioTab = await tabIdOf(options, pageUrl);
  await popup.goto(`chrome-extension://${id}/popup.html?tabId=${bioTab}`);
  await expect(popup.getByRole("status")).toHaveText(/Your role can't add contacts/);

  // A revoked key: 401 message.
  await options.getByLabel("API key").fill("al_00000000_notarealkeynotarealkeynotarealkeynotareal");
  await options.getByRole("button", { name: "Save and test connection" }).click();
  await expect(options.getByRole("status")).toHaveText(/The API key isn't valid or was revoked/);
  await popup.reload();
  await expect(popup.getByRole("status")).toHaveText(/The API key isn't valid or was revoked/);
});
