import http from "node:http";

/**
 * A local stand-in for People Data Labs, Apollo and Hunter on 127.0.0.1:48091. The dev server
 * sends every provider call here when DATA_PROVIDERS_TEST_BASE_URL points at it (honoured only
 * outside production), so the harness never reaches a real provider or spends real credits.
 *
 * Keys decide the answer: one containing "bad" gets 401, "broke" gets the provider's out-of-credits
 * status, anything else succeeds. A first name of "Nomatch" gets no match (404).
 */
export const PROVIDER_MOCK_PORT = 48091;
export const PROVIDER_MOCK_URL = `http://127.0.0.1:${PROVIDER_MOCK_PORT}`;

export interface MockCall {
  path: string;
  key: string;
  params: Record<string, string | undefined>;
}

export const providerCalls: MockCall[] = [];

type Send = (status: number, body: unknown) => void;

function pdl(path: string, params: Record<string, string | undefined>, send: Send) {
  if (path === "/v5/autocomplete") return send(200, { status: 200, data: [] });
  if (path === "/v5/person/enrich") {
    if (params.first_name === "Nomatch") return send(404, { status: 404, error: { type: "not_found" } });
    const first = (params.first_name ?? "pat").toLowerCase();
    const last = (params.last_name ?? "doe").toLowerCase();
    const domain = params.company?.includes(".") ? params.company : "example.org";
    return send(200, {
      status: 200,
      likelihood: 8,
      data: {
        full_name: `${first} ${last}`,
        job_title: "Head of Growth",
        job_title_levels: ["director"],
        work_email: `${first}.${last}@${domain}`,
        mobile_phone: "+1 555 0100",
        phone_numbers: ["+1 555 0100"],
        linkedin_url: `linkedin.com/in/${first}-${last}-mock`,
        location_locality: "Austin",
        location_region: "Texas",
        location_country: "United States",
      },
    });
  }
  if (path === "/v5/company/enrich") {
    return send(200, {
      status: 200,
      name: "mock co",
      display_name: "Mock Co",
      industry: "computer software",
      employee_count: 120,
      founded: 2015,
      linkedin_url: "linkedin.com/company/mock-co",
      location: { locality: "Austin", region: "Texas", country: "United States" },
      summary: "Mock Co makes test fixtures.",
    });
  }
  return send(404, { status: 404 });
}

function apollo(path: string, params: Record<string, string | undefined>, send: Send) {
  if (path === "/api/v1/auth/health") return send(200, { healthy: true, is_logged_in: true });
  if (path === "/api/v1/people/match") {
    const first = (params.first_name ?? "pat").toLowerCase();
    return send(200, {
      person: {
        title: "VP Sales",
        seniority: "vp",
        email: `${first}@${params.domain ?? "example.org"}`,
        email_status: "verified",
        linkedin_url: "http://www.linkedin.com/in/apollo-mock",
        city: "Denver",
        state: "Colorado",
        country: "United States",
      },
    });
  }
  if (path === "/api/v1/organizations/enrich") {
    return send(200, { organization: { name: "Apollo Mock", industry: "information technology" } });
  }
  return send(404, {});
}

function hunter(path: string, params: Record<string, string | undefined>, send: Send) {
  if (path === "/v2/account") return send(200, { data: { plan_name: "Free" } });
  if (path === "/v2/email-finder") {
    const first = (params.first_name ?? "pat").toLowerCase();
    return send(200, {
      data: { email: `${first}@${params.domain}`, score: 91, position: "Engineer", verification: { status: "valid" } },
    });
  }
  if (path === "/v2/domain-search") return send(200, { data: { organization: "Hunter Mock", emails: [] } });
  return send(404, {});
}

function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", PROVIDER_MOCK_URL);
  const params: Record<string, string | undefined> = Object.fromEntries(url.searchParams);
  const key = String(req.headers["x-api-key"] ?? params.api_key ?? "");
  providerCalls.push({ path: url.pathname, key, params });
  const send: Send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const isHunter = url.pathname.startsWith("/v2/");
  if (key.includes("bad")) return send(401, { error: "invalid key" });
  if (key.includes("broke")) return send(isHunter ? 429 : 402, { error: "no credits" });
  if (url.pathname.startsWith("/v5/")) return pdl(url.pathname, params, send);
  if (url.pathname.startsWith("/api/v1/")) return apollo(url.pathname, params, send);
  if (isHunter) return hunter(url.pathname, params, send);
  return send(404, {});
}

export interface ProviderMock {
  close: () => Promise<void>;
}

export async function startProviderMock(): Promise<ProviderMock> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => handle(req, res));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROVIDER_MOCK_PORT, "127.0.0.1", () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Calls the mock saw with this key since `from` (an index into providerCalls). */
export function callsWithKey(key: string, from = 0): MockCall[] {
  return providerCalls.slice(from).filter((c) => c.key === key);
}
