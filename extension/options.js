import {
  ApiError,
  apiCall,
  ext,
  hasServerPermission,
  loadConfig,
  messageFor,
  normalizeServerUrl,
  originPattern,
  saveConfig,
} from "./api.js";

const form = /** @type {HTMLFormElement} */ (document.getElementById("form"));
const serverInput = /** @type {HTMLInputElement} */ (document.getElementById("serverUrl"));
const keyInput = /** @type {HTMLInputElement} */ (document.getElementById("apiKey"));
const saveButton = /** @type {HTMLButtonElement} */ (document.getElementById("save"));
const forgetButton = /** @type {HTMLButtonElement} */ (document.getElementById("forget"));
const statusBox = /** @type {HTMLParagraphElement} */ (document.getElementById("status"));

/**
 * @param {string} text
 * @param {"error" | "positive" | "attention" | "neutral"} [tone]
 */
function show(text, tone = "neutral") {
  statusBox.textContent = text;
  statusBox.dataset.tone = tone;
  statusBox.hidden = false;
}

async function init() {
  const config = await loadConfig();
  if (!config) return;
  serverInput.value = config.serverUrl;
  keyInput.value = config.apiKey;
  if (!(await hasServerPermission(config.serverUrl))) {
    show(
      "Saved, but the extension can't reach the server yet. Click Save and test connection to allow it.",
      "attention",
    );
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const serverUrl = normalizeServerUrl(serverInput.value);
  const apiKey = keyInput.value.trim();
  if (!serverUrl) {
    show("Enter the server address, starting with https:// (http:// only for localhost).", "error");
    return;
  }
  if (!apiKey) {
    show("Paste an API key from Settings → API keys.", "error");
    return;
  }
  // The permission prompt must open straight from the click, before any other await.
  const pending = ext.permissions.request({ origins: [originPattern(serverUrl)] });
  saveButton.disabled = true;
  show("Testing the connection…");
  void testConnection(pending, { serverUrl, apiKey }).finally(() => {
    saveButton.disabled = false;
  });
});

/**
 * @param {Promise<boolean>} permission
 * @param {import("./api.js").Config} config
 */
async function testConnection(permission, config) {
  let granted = false;
  try {
    granted = await permission;
  } catch {
    granted = false;
  }
  if (!granted) {
    show(`Allow access to ${new URL(config.serverUrl).host} when Chrome asks, so the extension can reach it.`, "error");
    return;
  }
  serverInput.value = config.serverUrl;
  await saveConfig(config);
  try {
    const profile = await apiCall(config, "GET", "/api/v1/users/api_profile");
    if (profile.authenticatedAs !== "apiKey") {
      show("The server answered, but not for an API key. Check the key.", "error");
      return;
    }
    const workspace = /** @type {{ name?: string } | null} */ (profile.workspace);
    const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
    const canCreate = permissions.includes("contact:create");
    show(
      `Connected to ${workspace?.name ?? "your workspace"} as ${String(profile.roleLabel ?? profile.role)}.${
        canCreate ? "" : " This key's role can't add people; saving will be refused."
      }`,
      canCreate ? "positive" : "attention",
    );
  } catch (error) {
    show(error instanceof ApiError ? messageFor(error, "use this API") : "Something went wrong. Try again.", "error");
  }
}

forgetButton.addEventListener("click", () => {
  const serverUrl = normalizeServerUrl(serverInput.value);
  ext.storage.local
    .remove(["serverUrl", "apiKey"])
    .then(() => (serverUrl ? ext.permissions.remove({ origins: [originPattern(serverUrl)] }) : false))
    .then(() => {
      keyInput.value = "";
      show("The API key was removed from this browser.");
    })
    .catch(() => show("The key couldn't be removed. Try again.", "error"));
});

init().catch(() => show("The saved settings couldn't be read.", "error"));
