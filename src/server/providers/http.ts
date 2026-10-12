import "server-only";

import { PROVIDER_NAMES, ProviderError, type ProviderId, SENIORITIES, type Seniority } from "./types";

const TIMEOUT_MS = 15_000;

/**
 * The provider's base URL. `DATA_PROVIDERS_TEST_BASE_URL` points every provider at one local mock
 * server for the test harness; it is ignored in production so a stray variable can never send a
 * workspace's key anywhere but the provider.
 */
export function baseUrl(defaultUrl: string): string {
  const override = process.env.DATA_PROVIDERS_TEST_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/+$/, "");
  return defaultUrl;
}

function errorFor(provider: ProviderId, status: number): ProviderError {
  const name = PROVIDER_NAMES[provider];
  if (status === 401)
    return new ProviderError("unauthorized", `${name} rejected the API key. Check it and save it again.`);
  if (status === 402) return new ProviderError("no_credits", `${name} says the account has no credits left.`);
  if (status === 429) return new ProviderError("rate_limited", `${name} is rate limiting this key. Try again later.`);
  if (status === 403) {
    return new ProviderError("forbidden", `${name} refused the request. The key's plan may not include this API.`);
  }
  return new ProviderError("unavailable", `${name} answered with an error (HTTP ${status}). Try again later.`);
}

export interface ProviderResponse {
  status: number;
  body: unknown;
}

/**
 * Call a provider and return the parsed JSON. 404 is returned (no match), every other non-2xx
 * becomes a ProviderError with a plain message. URLs are never logged: Hunter's key is in the query.
 */
export async function providerFetch(
  provider: ProviderId,
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    statusMap?: (s: number) => number;
  },
): Promise<ProviderResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    const name = PROVIDER_NAMES[provider];
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ProviderError("timeout", `${name} didn't answer in time. Try again later.`);
    }
    throw new ProviderError("unavailable", `Couldn't reach ${name}. Try again later.`);
  }
  const status = init.statusMap ? init.statusMap(res.status) : res.status;
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (status === 404) return { status, body };
  if (status < 200 || status >= 300) throw errorFor(provider, status);
  if (body === null || typeof body !== "object") {
    throw new ProviderError("bad_response", `${PROVIDER_NAMES[provider]} sent an answer that couldn't be read.`);
  }
  return { status, body };
}

/* ------------------------------ Normalisers -------------------------------- */

export type Json = Record<string, unknown>;

export function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

/** A trimmed string; booleans and other placeholders (PDL's free plan returns `true`) become null. */
export function str(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function int(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function year(value: unknown): number | null {
  const n = int(value);
  return n !== null && n >= 1600 && n <= new Date().getFullYear() ? n : null;
}

export function email(value: unknown): string | null {
  const text = str(value, 320)?.toLowerCase() ?? null;
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

/** linkedin.com/in/x, www.linkedin.com/in/x/ → https://www.linkedin.com/in/x */
export function linkedin(value: unknown): string | null {
  const text = str(value, 300);
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function titleCase(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const SENIORITY_ALIASES: Record<string, Seniority> = {
  cxo: "c_suite",
  c_level: "c_suite",
  csuite: "c_suite",
  executive: "c_suite",
  vice_president: "vp",
  training: "intern",
  unpaid: "intern",
  junior: "entry",
};

/** Map a provider's seniority label to ours, else null. */
export function seniority(value: unknown): Seniority | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = str(raw)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!text) return null;
  if ((SENIORITIES as readonly string[]).includes(text)) return text as Seniority;
  return SENIORITY_ALIASES[text] ?? null;
}
