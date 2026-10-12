import { ApiError, apiCall, ext, hasServerPermission, loadConfig, messageFor } from "./api.js";
import { readPerson } from "./reader.js";

/** @typedef {import("./api.js").Config} Config */
/** @typedef {import("./reader.js").PersonDraft} PersonDraft */
/**
 * @typedef {object} ContactRow
 * @property {string} id
 * @property {string} name
 * @property {string | null} linkedinUrl
 * @property {{ id: string; name: string } | null} company
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusBox = $("status");
const form = /** @type {HTMLFormElement} */ ($("form"));
const saveButton = /** @type {HTMLButtonElement} */ ($("save"));
const listSelect = /** @type {HTMLSelectElement} */ ($("listId"));
const openRecord = /** @type {HTMLAnchorElement} */ ($("openRecord"));

const FIELDS = /** @type {const} */ ([
  "firstName",
  "lastName",
  "title",
  "companyName",
  "companyDomain",
  "location",
  "email",
  "linkedinUrl",
]);

/** @type {{ config: Config; permissions: string[]; workspace: string; pageUrl: string } | null} */
let state = null;

/**
 * @param {string} text
 * @param {"error" | "positive" | "attention" | "neutral"} [tone]
 * @param {{ href: string; label: string }} [link]
 */
function show(text, tone = "neutral", link) {
  statusBox.textContent = text;
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.label;
    statusBox.append(" ", a);
  }
  statusBox.dataset.tone = tone;
  statusBox.hidden = false;
}

/** @param {string} id */
const recordUrl = (id) =>
  state ? new URL(`/dashboard/people/${encodeURIComponent(id)}`, state.config.serverUrl).href : "#";

/** @param {string | null | undefined} url */
function linkedinKey(url) {
  const match = String(url ?? "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/** @param {string | null | undefined} a @param {string | null | undefined} b */
const sameText = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** "City, Region, Country" → the contact's city, state and country. */
function splitLocation(/** @type {string} */ text) {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };
  if (parts.length === 2) return { city: parts[0], country: parts[1] };
  return { city: parts[0], state: parts[1], country: parts[parts.length - 1] };
}

/** The tab to read: the active tab, or `?tabId=` when the popup is opened as a page. */
async function targetTabId() {
  const fromQuery = Number.parseInt(new URLSearchParams(location.search).get("tabId") ?? "", 10);
  if (Number.isInteger(fromQuery) && fromQuery >= 0) return fromQuery;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" ? tab.id : null;
}

/**
 * Inject the reader into the tab once (activeTab grants this for the tab the user clicked on).
 * @returns {Promise<PersonDraft | null>}
 */
async function readTab() {
  const tabId = await targetTabId();
  if (tabId === null) throw new Error("no tab");
  const [result] = await ext.scripting.executeScript({ target: { tabId }, func: readPerson });
  return result?.result ?? null;
}

/** @returns {Record<(typeof FIELDS)[number], string>} */
function formValues() {
  const data = new FormData(form);
  return /** @type {Record<(typeof FIELDS)[number], string>} */ (
    Object.fromEntries(FIELDS.map((f) => [f, String(data.get(f) ?? "").trim()]))
  );
}

/**
 * The saved person this page is about: an exact LinkedIn match, or a name and company match.
 * @param {Config} config
 * @param {Record<(typeof FIELDS)[number], string>} v
 * @returns {Promise<{ contact: ContactRow; exact: boolean } | null>}
 */
async function findExisting(config, v) {
  const name = [v.firstName, v.lastName].filter(Boolean).join(" ");
  const key = linkedinKey(v.linkedinUrl);
  /** @type {ContactRow[]} */
  const rows = [];
  if (name) {
    const res = await apiCall(config, "POST", "/api/v1/contacts/search", { name, per_page: 25 });
    rows.push(...(Array.isArray(res.contacts) ? res.contacts : []));
  }
  if (v.email) {
    const res = await apiCall(config, "POST", "/api/v1/contacts/search", { q: v.email, per_page: 5 });
    rows.push(...(Array.isArray(res.contacts) ? res.contacts : []));
  }
  const exact = rows.find((c) => key && linkedinKey(c.linkedinUrl) === key);
  if (exact) return { contact: exact, exact: true };
  const possible = rows.find((c) => (v.companyName ? sameText(c.company?.name, v.companyName) : !c.company));
  return possible ? { contact: possible, exact: false } : null;
}

/**
 * The company id for the name or domain: an existing account, or a new one when the role may create it.
 * @param {Config} config
 * @param {string[]} permissions
 * @param {string} name
 * @param {string} domain
 * @returns {Promise<string | null>}
 */
async function resolveCompany(config, permissions, name, domain) {
  if ((!name && !domain) || !permissions.includes("company:read")) return null;
  if (domain) {
    const res = await apiCall(config, "POST", "/api/v1/accounts/search", { domains: [domain], per_page: 1 });
    const [found] = Array.isArray(res.accounts) ? res.accounts : [];
    if (found) return found.id;
  }
  if (name) {
    const res = await apiCall(config, "POST", "/api/v1/accounts/search", { q: name, per_page: 25 });
    const found = (Array.isArray(res.accounts) ? res.accounts : []).find((a) => sameText(a.name, name));
    if (found) return found.id;
  }
  if (!permissions.includes("company:create")) return null;
  const created = await apiCall(config, "POST", "/api/v1/accounts", {
    name: name || domain,
    ...(domain ? { domain } : {}),
    runDedupe: true,
  });
  return /** @type {{ id: string }} */ (created.account).id;
}

/** @param {Config} config */
async function loadLists(config) {
  const res = await apiCall(config, "GET", "/api/v1/labels?entityType=contact");
  const lists = (Array.isArray(res.labels) ? res.labels : []).filter((l) => l.kind === "static");
  for (const list of lists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    listSelect.append(option);
  }
  $("listField").hidden = lists.length === 0;
}

/** @param {string} id @param {string} text */
function finish(id, text) {
  form.hidden = true;
  show(text, "positive");
  openRecord.href = recordUrl(id);
  $("openLabel").textContent = `Open in ${state?.workspace ?? "your workspace"}`;
  $("done").hidden = false;
}

async function save() {
  if (!state) return;
  const { config, permissions } = state;
  const v = formValues();
  if (!v.firstName && !v.lastName && !v.email) {
    show("Give the person a name or an email address.", "error");
    return;
  }
  saveButton.disabled = true;
  $("saveLabel").textContent = "Saving…";
  try {
    const companyId = await resolveCompany(config, permissions, v.companyName, v.companyDomain.toLowerCase());
    /** @type {Record<string, unknown>} */
    const body = {
      source: "browser_extension",
      sourceUrl: state.pageUrl,
      ...splitLocation(v.location),
    };
    for (const key of /** @type {const} */ (["firstName", "lastName", "title", "email", "linkedinUrl"])) {
      if (v[key]) body[key] = v[key];
    }
    if (companyId) body.companyId = companyId;
    let id;
    let text;
    try {
      const res = await apiCall(config, "POST", "/api/v1/contacts", body);
      id = /** @type {{ id: string }} */ (res.contact).id;
      text = `Saved to ${state.workspace}.`;
    } catch (error) {
      const existingId = error instanceof ApiError && error.status === 409 ? error.details?.existingId : null;
      if (typeof existingId !== "string") throw error;
      id = existingId;
      text = "A person with this email is already saved.";
    }
    const listId = listSelect.value;
    if (listId) {
      try {
        await apiCall(config, "POST", "/api/v1/labels/add_entity_ids", { listId, entityIds: [id] });
        text += ` Added to ${listSelect.selectedOptions[0]?.textContent ?? "the list"}.`;
      } catch (error) {
        text += ` It wasn't added to the list: ${messageFor(error, "change lists")}`;
      }
    }
    finish(id, text);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) show("Your role can't add contacts.", "error");
    else if (error instanceof ApiError && error.status === 422) {
      const detail = Array.isArray(error.details) ? error.details[0] : null;
      show(detail?.message ? `${error.message} ${detail.message}` : error.message, "error");
    } else show(messageFor(error, "add contacts"), "error");
    saveButton.disabled = false;
    $("saveLabel").textContent = `Save to ${state.workspace}`;
  }
}

async function main() {
  const config = await loadConfig();
  if (!config) {
    show(
      "Connect the extension to your workspace first: add the server URL and an API key in the options.",
      "attention",
    );
    $("setup").hidden = false;
    return;
  }
  if (!(await hasServerPermission(config.serverUrl))) {
    show(
      "The extension isn't allowed to reach your server yet. Open the options and save the connection again.",
      "attention",
    );
    $("setup").hidden = false;
    return;
  }

  const [personResult, profileResult] = await Promise.allSettled([
    readTab(),
    apiCall(config, "GET", "/api/v1/users/api_profile"),
  ]);
  if (profileResult.status === "rejected") {
    show(messageFor(profileResult.reason, "use this API"), "error");
    $("setup").hidden = false;
    return;
  }
  const profile = profileResult.value;
  const workspace = /** @type {{ name?: string } | null} */ (profile.workspace)?.name ?? "your workspace";
  const permissions = Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
  $("workspace").textContent = workspace;

  if (personResult.status === "rejected") {
    show(
      "This page can't be read. Browser pages and extension stores are off limits; try a regular web page.",
      "error",
    );
    return;
  }
  const person = personResult.value;
  if (!person) {
    show(
      "No single person found on this page. Open one person's profile or bio page and click the button again.",
      "attention",
    );
    return;
  }
  if (!permissions.includes("contact:create")) {
    show("Your role can't add contacts. Ask a workspace admin for a key with the member role or above.", "error");
    return;
  }

  state = { config, permissions, workspace, pageUrl: person.pageUrl };
  for (const field of FIELDS) {
    const input = /** @type {HTMLInputElement} */ (form.elements.namedItem(field));
    input.value = person[field] ?? "";
  }
  $("pageUrl").textContent = person.pageUrl;
  $("saveLabel").textContent = `Save to ${workspace}`;
  show("Check the details, then save.");
  form.hidden = false;

  const tasks = [];
  if (permissions.includes("list:read") && permissions.includes("list:update")) {
    tasks.push(loadLists(config).catch(() => undefined));
  }
  if (permissions.includes("contact:read")) {
    tasks.push(
      findExisting(config, formValues())
        .then((match) => {
          if (!match) return;
          if (match.exact) {
            form.hidden = true;
            show(`Already saved in ${workspace}.`, "positive");
            openRecord.href = recordUrl(match.contact.id);
            $("openLabel").textContent = `Open in ${workspace}`;
            $("done").hidden = false;
          } else {
            show(`${match.contact.name} may already be saved.`, "attention", {
              href: recordUrl(match.contact.id),
              label: "Open the saved person",
            });
            $("saveLabel").textContent = "Save as a new person";
          }
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  save().catch(() => show("Something went wrong. Try again.", "error"));
});
$("openOptions").addEventListener("click", () => {
  ext.runtime.openOptionsPage().catch(() => undefined);
});
main().catch(() => show("Something went wrong. Close the popup and try again.", "error"));
