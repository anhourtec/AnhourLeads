import "dotenv/config";

import pg from "pg";

import http from "node:http";

/**
 * Fixtures for the discovery index and crawler fleet specs (WP-F).
 *
 * A small virtual-host server on port 48091 (all interfaces, IPv4 and IPv6) that answers for
 * several fake sites by Host header. `*.localhost` resolves to the loopback address, and the dev
 * server runs with CRAWLER_ALLOW_PRIVATE_HOSTS=true, so the crawler can reach them; nothing ever
 * leaves this machine. Sites:
 *
 *  - nimbus-disco.localhost   a company: JSON-LD Organization, about, team (JSON-LD people),
 *                             contact (disallowed by robots.txt), careers linking a Greenhouse and a
 *                             Lever board, an RSS feed, links to LinkedIn / Facebook (never fetched).
 *                             robots.txt asks for Crawl-delay: 2.5.
 *  - ats-disco.localhost      the job boards' public JSON APIs (Greenhouse, Lever).
 *  - wikidata-disco.localhost a canned SPARQL endpoint.
 *  - blocked-disco.localhost  robots.txt disallows everything.
 *  - optout-disco.localhost   a company used for opt-out checks.
 *  - control.localhost        GET /__log (requests seen), POST /__team?variant=v1|v2 (team page).
 *
 * The request log and the team variant live in whichever worker started the server; the control
 * host makes them reachable from any worker.
 */
export const DISCO_PORT = 48091;
export const disco = (site: string) => `${site}-disco.localhost:${DISCO_PORT}`;
export const discoUrl = (site: string, path = "/") => `http://${disco(site)}${path}`;
const CONTROL = `http://control.localhost:${DISCO_PORT}`;

export interface DiscoRequest {
  host: string;
  path: string;
  userAgent: string;
  at: number;
}

const state: { team: "v1" | "v2"; log: DiscoRequest[] } = { team: "v1", log: [] };

const html = (title: string, body: string, head = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

const NIMBUS_ORG = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Nimbus Analytics",
  description: "Nimbus Analytics builds forecasting software for logistics teams.",
  foundingDate: "2015-03-01",
  numberOfEmployees: { "@type": "QuantitativeValue", value: 42 },
  telephone: "+1 416 555 0100",
  address: { "@type": "PostalAddress", addressLocality: "Toronto", addressCountry: "Canada" },
  sameAs: ["https://www.linkedin.com/company/nimbus-disco", "https://x.com/nimbusdisco"],
};

function teamPage(variant: "v1" | "v2"): string {
  const people = [
    { name: "Ada Lovelace", jobTitle: "Chief Executive Officer", email: "ada.lovelace@nimbus-disco.localhost" },
    { name: "Grace Hopper", jobTitle: "VP Engineering", email: "grace.hopper@nimbus-disco.localhost" },
    ...(variant === "v1" ? [{ name: "Alan Turing", jobTitle: "Senior Software Engineer" }] : []),
  ];
  const ld = { "@context": "https://schema.org", "@graph": people.map((p) => ({ "@type": "Person", ...p })) };
  return html(
    "Team | Nimbus Analytics",
    `<h1>Our team</h1>${people.map((p) => `<h3>${p.name}</h3><p>${p.jobTitle}</p>`).join("")}
     <a href="https://www.linkedin.com/in/ada-lovelace">LinkedIn</a><a href="/">Home</a>`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  );
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Nimbus news</title>
<item><title>Nimbus raises a seed round</title><link>http://${disco("nimbus")}/news/seed-round</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title><![CDATA[Nimbus & Partners launch forecasting 2.0]]></title><link>http://${disco("nimbus")}/news/forecasting-2</link><pubDate>Thu, 01 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

const GREENHOUSE = {
  jobs: [
    {
      id: 1,
      title: "Senior Data Engineer",
      absolute_url: "https://boards.greenhouse.io/nimbusdisco/jobs/1",
      location: { name: "Toronto" },
      updated_at: "2026-10-01T12:00:00Z",
      departments: [{ name: "Engineering" }],
    },
    {
      id: 2,
      title: "Account Executive",
      absolute_url: "https://boards.greenhouse.io/nimbusdisco/jobs/2",
      location: { name: "Remote" },
      updated_at: "2026-09-20T12:00:00Z",
    },
  ],
};

const LEVER = [
  {
    id: "abc",
    text: "Product Designer",
    hostedUrl: "https://jobs.lever.co/nimbusdisco/abc",
    categories: { team: "Design", location: "Toronto", commitment: "Full-time" },
    createdAt: 1_790_000_000_000,
  },
];

function sparqlResult(): unknown {
  const row = (qid: string, label: string, website: string, extra: Record<string, string> = {}) => ({
    item: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { type: "literal", value: label },
    website: { type: "uri", value: website },
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { type: "literal", value: v }])),
  });
  return {
    head: {
      vars: ["item", "itemLabel", "website", "countryLabel", "industryLabel", "employees", "inception", "hqLabel"],
    },
    results: {
      bindings: [
        row("Q90000001", "Acme Wiki Industries", `http://${disco("wikiacme")}/`, {
          countryLabel: "Canada",
          industryLabel: "software industry",
          employees: "120",
          inception: "2009-01-01T00:00:00Z",
          hqLabel: "Montreal",
        }),
        row("Q90000002", "Social Only Co", "https://www.linkedin.com/company/social-only"),
        row("Q90000003", "Q90000003", `http://${disco("wikibeta")}/`, { countryLabel: "Germany" }),
      ],
    },
  };
}

function route(host: string, url: URL): { status: number; type: string; body: string } {
  const site = host.split(":")[0]?.replace(/-disco\.localhost$/, "") ?? "";
  const path = url.pathname;
  const ok = (type: string, body: string) => ({ status: 200, type, body });
  const H = "text/html; charset=utf-8";
  const notFound = { status: 404, type: H, body: html("Not found", "<p>Not found</p>") };

  if (site === "nimbus") {
    if (path === "/robots.txt") {
      return ok("text/plain", "User-agent: *\nDisallow: /contact\nDisallow: /private\nCrawl-delay: 2.5\n");
    }
    if (path === "/") {
      return ok(
        H,
        html(
          "Nimbus Analytics | Forecasting for logistics",
          `<h1>Nimbus Analytics</h1><p>We help logistics teams plan.</p>
           <a href="/about">About us</a> <a href="/team">Team</a> <a href="/contact">Contact</a> <a href="/careers">Careers</a>
           <a href="/private/secret">Internal</a> <a href="/blog/some-post">Blog</a>
           <a href="https://www.linkedin.com/company/nimbus-disco">LinkedIn</a> <a href="https://www.facebook.com/nimbusdisco">Facebook</a>
           <a href="https://x.com/nimbusdisco">X</a>`,
          `<script type="application/ld+json">${JSON.stringify(NIMBUS_ORG)}</script>
           <link rel="alternate" type="application/rss+xml" href="/news/feed.xml">
           <script src="https://js.hs-scripts.com/123.js"></script>`,
        ),
      );
    }
    if (path === "/about")
      return ok(H, html("About | Nimbus", "<h1>About</h1><p>Founded in 2015 in Toronto.</p><a href='/team'>Team</a>"));
    if (path === "/team") return ok(H, teamPage(state.team));
    if (path === "/careers") {
      return ok(
        H,
        html(
          "Careers | Nimbus",
          `<h1>Join us</h1><p>We're hiring.</p>
           <a href="https://boards.greenhouse.io/nimbusdisco">Open roles</a>
           <a href="https://jobs.lever.co/nimbusdisco">Design roles</a>`,
        ),
      );
    }
    if (path === "/contact") return ok(H, html("Contact", "<a href='mailto:hello@nimbus-disco.localhost'>Email</a>"));
    if (path === "/news/feed.xml") return ok("application/rss+xml", RSS);
    return notFound;
  }
  if (site === "ats") {
    if (path === "/robots.txt") return ok("text/plain", "User-agent: *\nAllow: /\n");
    if (path === "/v1/boards/nimbusdisco/jobs") return ok("application/json", JSON.stringify(GREENHOUSE));
    if (path === "/v0/postings/nimbusdisco") return ok("application/json", JSON.stringify(LEVER));
    return { status: 404, type: "application/json", body: "{}" };
  }
  if (site === "wikidata") {
    if (path === "/sparql") {
      const offset = Number(url.searchParams.get("query")?.match(/OFFSET (\d+)/)?.[1] ?? "0");
      const body = offset > 0 ? { head: { vars: [] }, results: { bindings: [] } } : sparqlResult();
      return ok("application/sparql-results+json", JSON.stringify(body));
    }
    return notFound;
  }
  if (site === "blocked") {
    if (path === "/robots.txt") return ok("text/plain", "User-agent: *\nDisallow: /\n");
    return ok(H, html("Blocked", "<p>Should never be fetched.</p>"));
  }
  if (site === "optout" || site === "wikiacme" || site === "wikibeta") {
    if (path === "/robots.txt") return { status: 404, type: "text/plain", body: "" };
    if (path === "/") return ok(H, html(`${site} home`, `<h1>${site}</h1><a href="/team">Team</a>`));
    if (path === "/team") return ok(H, html("Team", "<h3>Olivia Optout</h3><p>Chief Executive Officer</p>"));
    return notFound;
  }
  return notFound;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const url = new URL(req.url ?? "/", `http://${host || "localhost"}`);
  if (host.startsWith("control.localhost")) {
    if (url.pathname === "/__ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("discovery-fixtures");
    }
    if (url.pathname === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(state.log));
    }
    if (url.pathname === "/__team" && req.method === "POST") {
      state.team = url.searchParams.get("variant") === "v2" ? "v2" : "v1";
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(state.team);
    }
  }
  state.log.push({ host, path: url.pathname, userAgent: String(req.headers["user-agent"] ?? ""), at: Date.now() });
  const out = route(host, url);
  res.writeHead(out.status, { "content-type": out.type });
  res.end(out.body);
}

async function alreadyServing(): Promise<boolean> {
  try {
    const res = await fetch(`${CONTROL}/__ping`);
    return res.ok && (await res.text()) === "discovery-fixtures";
  } catch {
    return false;
  }
}

export interface DiscoFixture {
  started: boolean;
  close: () => Promise<void>;
}

export async function startDiscoveryFixtures(): Promise<DiscoFixture> {
  if (await alreadyServing()) return { started: false, close: () => Promise.resolve() };
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  const started = await new Promise<boolean>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    // "::" with dual-stack accepts both ::1 and 127.0.0.1 (*.localhost resolves to either).
    server.listen({ port: DISCO_PORT, host: "::", ipv6Only: false }, () => resolve(true));
  });
  if (!started) return { started: false, close: () => Promise.resolve() };
  return {
    started: true,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export async function fixtureLog(): Promise<DiscoRequest[]> {
  const res = await fetch(`${CONTROL}/__log`);
  return (await res.json()) as DiscoRequest[];
}

export async function setTeamVariant(variant: "v1" | "v2"): Promise<void> {
  await fetch(`${CONTROL}/__team?variant=${variant}`, { method: "POST" });
}

/* -------------------------------------------------------------------------- */
/* Database helpers (assertions and cleanup only)                             */
/* -------------------------------------------------------------------------- */

let pool: pg.Pool | null = null;
export function discoDb(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return pool;
}

export async function closeDiscoDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export async function q<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await discoDb().query<T>(text, params)).rows;
}

/** Remove everything a discovery spec left behind for hosts or domains matching `like` (e.g. '%disco.localhost%'). */
export async function cleanDiscovery(like: string): Promise<void> {
  await q("delete from crawl_frontier where host like $1 or url like $1", [like]);
  await q("delete from crawl_host where host like $1", [like]);
  await q("delete from index_company where domain like $1", [like]);
  await q("delete from index_optout where value like $1", [like]);
}

/** Seed index rows directly (search and save specs don't need a crawl). Returns the ids. */
export async function insertIndexCompany(row: {
  domain: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  foundedYear?: number | null;
  technologies?: string[];
  keywords?: string[];
  emailPattern?: string | null;
}): Promise<string> {
  const [r] = await q<{ id: string }>(
    `insert into index_company (id, domain, name, website_url, industry, country, city, employee_count, employee_range,
       founded_year, technologies, keywords, email_pattern, sources, last_crawled_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now())
     returning id`,
    [
      row.domain,
      row.name,
      `https://${row.domain}`,
      row.industry ?? null,
      row.country ?? null,
      row.city ?? null,
      row.employeeCount ?? null,
      row.employeeRange ?? null,
      row.foundedYear ?? null,
      row.technologies ?? [],
      row.keywords ?? [],
      row.emailPattern ?? null,
      JSON.stringify([
        {
          source: "crawl",
          url: `https://${row.domain}/`,
          retrievedAt: new Date().toISOString(),
          fields: ["name", "industry"],
        },
      ]),
    ],
  );
  if (!r) throw new Error("insert failed");
  return r.id;
}

export async function insertIndexPerson(row: {
  companyId: string;
  fullName: string;
  title: string;
  seniority: string | null;
  department: string | null;
  publishedEmail?: string | null;
  sourceUrl: string;
  goneAt?: Date | null;
}): Promise<string> {
  const [first, ...rest] = row.fullName.split(" ");
  const [r] = await q<{ id: string }>(
    `insert into index_person (id, company_id, full_name, first_name, last_name, title, seniority, department,
       published_email, source_url, gone_at)
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      row.companyId,
      row.fullName,
      first ?? null,
      rest.join(" ") || null,
      row.title,
      row.seniority,
      row.department,
      row.publishedEmail ?? null,
      row.sourceUrl,
      row.goneAt ?? null,
    ],
  );
  if (!r) throw new Error("insert failed");
  return r.id;
}

export async function insertJob(companyId: string, title: string, url: string, daysAgo = 1): Promise<void> {
  await q(
    `insert into index_job_posting (id, company_id, title, url, source, last_seen_at)
     values (gen_random_uuid()::text, $1, $2, $3, 'Greenhouse', now() - ($4 || ' days')::interval)`,
    [companyId, title, url, String(daysAgo)],
  );
}
