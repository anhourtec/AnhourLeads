"use client";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Same-origin call to the /api/v1 endpoints; returns the API's plain error message on failure. */
export async function apiRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const hasBody = init.body !== undefined;
    const isForm = init.body instanceof FormData;
    let body: BodyInit | undefined;
    if (isForm) body = init.body as FormData;
    else if (hasBody) body = JSON.stringify(init.body);
    const res = await fetch(path, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: hasBody && !isForm ? { "content-type": "application/json" } : undefined,
      body,
      credentials: "same-origin",
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const body = (json ?? {}) as { error?: string; details?: { message?: string }[] };
      const detail = Array.isArray(body.details) ? body.details[0]?.message : undefined;
      return { ok: false, status: res.status, error: detail ?? body.error ?? "Something went wrong. Try again." };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
