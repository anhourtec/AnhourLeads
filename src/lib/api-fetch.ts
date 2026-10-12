/** Result of a JSON call to our own /api/v1 endpoints from the browser. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; fields: Record<string, string> };

interface ErrorBody {
  error?: string;
  message?: string;
  details?: { path?: string; message?: string }[];
}

/** Call an /api/v1 endpoint with JSON and turn errors into a readable sentence plus per-field messages. */
export async function apiFetch<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : {};
    if (res.ok) return { ok: true, data: json as T };
    const body = json as ErrorBody;
    const fields: Record<string, string> = {};
    for (const d of Array.isArray(body.details) ? body.details : []) {
      if (d.path && d.message && !fields[d.path]) fields[d.path] = d.message;
    }
    const first = Object.values(fields)[0];
    const error =
      res.status === 422 && first ? first : (body.error ?? body.message ?? "Something went wrong. Try again.");
    return { ok: false, status: res.status, error, fields };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Couldn't reach the server. Check your connection and try again.",
      fields: {},
    };
  }
}
