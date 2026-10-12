/**
 * Settings and API calls shared by the popup and the options page.
 *
 * The extension authenticates with a workspace API key (X-Api-Key), never with the browser's
 * session cookies (`credentials: "omit"`). Extension pages that hold the host permission for the
 * server origin are not subject to CORS, so the server needs no CORS change, and the key-based
 * actor is not subject to the cookie CSRF check.
 */

/** The WebExtension API, read from globalThis so the files lint as plain browser modules. */
export const ext = Reflect.get(globalThis, "chrome");

/**
 * @typedef {object} Config
 * @property {string} serverUrl Origin of the AnhourLeads installation or workspace host.
 * @property {string} apiKey Workspace API key (Settings → API keys).
 */

/**
 * @typedef {object} Profile
 * @property {"apiKey" | "user"} authenticatedAs
 * @property {{ id: string; name: string; slug: string } | null} workspace
 * @property {{ id: string; name: string; prefix: string } | null} apiKey
 * @property {string} role
 * @property {string} roleLabel
 * @property {string[]} permissions
 */

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/i;

/**
 * The server origin from what the user typed, or null. https everywhere; http only for local hosts,
 * so an API key never travels in clear text over the internet.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeServerUrl(input) {
  const raw = input.trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.test(url.hostname)) return url.origin;
  return null;
}

/**
 * The host permission pattern for a server origin. Match patterns ignore the port, so
 * `http://acme.localhost:3410` becomes `http://acme.localhost/*`.
 * @param {string} serverUrl
 */
export function originPattern(serverUrl) {
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

/** @returns {Promise<Config | null>} */
export async function loadConfig() {
  const stored = await ext.storage.local.get(["serverUrl", "apiKey"]);
  if (typeof stored.serverUrl !== "string" || typeof stored.apiKey !== "string") return null;
  if (!stored.serverUrl || !stored.apiKey) return null;
  return { serverUrl: stored.serverUrl, apiKey: stored.apiKey };
}

/** @param {Config} config */
export async function saveConfig(config) {
  await ext.storage.local.set({ serverUrl: config.serverUrl, apiKey: config.apiKey });
}

/** @param {string} serverUrl */
export async function hasServerPermission(serverUrl) {
  return Boolean(await ext.permissions.contains({ origins: [originPattern(serverUrl)] }));
}

export class ApiError extends Error {
  /**
   * @param {number} status 0 when the server could not be reached.
   * @param {string} message
   * @param {Record<string, unknown> | null} [details]
   */
  constructor(status, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Call the workspace API with the API key.
 * @param {Config} config
 * @param {"GET" | "POST"} method
 * @param {string} path Starts with /api/v1/.
 * @param {unknown} [body]
 * @returns {Promise<Record<string, unknown>>} The JSON body.
 */
export async function apiCall(config, method, path, body) {
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json", "x-api-key": config.apiKey };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(new URL(path, config.serverUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, `Can't reach ${config.serverUrl}. Check the server URL and your connection.`);
  }
  /** @type {Record<string, unknown> | null} */
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data && typeof data.error === "string" ? data.error : `The server answered ${res.status}.`;
    const details = data?.details && typeof data.details === "object" ? data.details : null;
    throw new ApiError(res.status, message, /** @type {Record<string, unknown> | null} */ (details));
  }
  return data ?? {};
}

/**
 * A plain sentence for an error, for the given action ("add people", "read lists"…).
 * @param {unknown} error
 * @param {string} [action]
 */
export function messageFor(error, action = "do this") {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  switch (error.status) {
    case 401:
      return "The API key isn't valid or was revoked. Create a new one in Settings → API keys and paste it in the extension options.";
    case 403:
      return `Your role can't ${action}. Ask a workspace admin for a key with a higher role.`;
    case 404:
      return "The server didn't recognise this address. Check the server URL in the extension options.";
    case 429:
      return "Too many requests. Wait a minute and try again.";
    default:
      return error.message;
  }
}
