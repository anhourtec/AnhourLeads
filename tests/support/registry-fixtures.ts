import http from "node:http";

/**
 * Fixtures for the official-registry seed sources (Companies House, SEC EDGAR).
 *
 * A virtual-host server on port 48094 (IPv4 and IPv6) that answers, by Host header, as:
 *
 *  - wd-reg.localhost       a SPARQL endpoint mapping Companies House numbers (P2622) and SEC CIKs
 *                           (P5531) to websites, like Wikidata's.
 *  - ch-reg.localhost       the Companies House public data API (profiles, officers, advanced search).
 *                           Officers carry a date of birth, nationality and addresses, which must never
 *                           reach the index.
 *  - sec-reg.localhost      www.sec.gov (company_tickers.json and ownership filings).
 *  - secdata-reg.localhost  data.sec.gov (submissions).
 *
 * Company websites (`*-reg.localhost:48094`) are only queued by the runs, never fetched by a
 * worker (reserved hosts). Nothing leaves this machine.
 */
export const REG_PORT = 48094;
export const regHost = (site: string) => `${site}-reg.localhost:${REG_PORT}`;
export const regUrl = (site: string, path = "") => `http://${regHost(site)}${path}`;

export const CH_ENDPOINT = regUrl("ch");
export const SEC_ENDPOINT = regUrl("sec");
export const SEC_DATA_ENDPOINT = regUrl("secdata");
export const WIKIDATA_ENDPOINT = regUrl("wd", "/sparql");

/** Companies House numbers and SEC CIKs used by the fixtures (unique to them). */
export const CH = {
  northwind: "01234567",
  dissolved: "07654321",
  optedOut: "SC123456",
  quill: "08888888",
  noweb: "09999999",
  twin: "05555555",
} as const;
export const CIK = { harbor: "9900001", lighthouse: "9900002", nowhere: "9900003" } as const;

export interface RegRequest {
  host: string;
  path: string;
  userAgent: string;
  authorization: string;
}

const log: RegRequest[] = [];
const CONTROL = `http://control-reg.localhost:${REG_PORT}`;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function sparql(query: string): unknown {
  const binding = (qid: string, id: string, website: string, label: string) => ({
    item: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` },
    id: { type: "literal", value: id },
    website: { type: "uri", value: website },
    itemLabel: { type: "literal", value: label, "xml:lang": "en" },
  });
  const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? "0");
  if (offset > 0) return { head: { vars: [] }, results: { bindings: [] } };
  if (query.includes("P2622")) {
    return {
      results: {
        bindings: [
          binding("Q91000001", "01234567", regUrl("northwind", "/about"), "Northwind Trading"),
          binding("Q91000001", "01234567", regUrl("northwind", "/"), "Northwind Trading"),
          binding("Q91000002", "7654321", regUrl("deadco", "/"), "Dead Co"),
          binding("Q91000003", "SC123456", regUrl("optedout", "/"), "Opted Out Ltd"),
          binding("Q91000004", "06666666", "https://www.linkedin.com/company/social-only", "Social Only"),
        ],
      },
    };
  }
  if (query.includes("P5531")) {
    return { results: { bindings: [binding("Q92000001", "0009900001", regUrl("harbor", "/"), "Harbor Robotics")] } };
  }
  return { results: { bindings: [] } };
}

const PERSONAL = {
  date_of_birth: { month: 4, year: 1970 },
  nationality: "British",
  country_of_residence: "England",
  occupation: "Company Director",
  address: { premises: "1", address_line_1: "Home Street", locality: "London", postal_code: "N1 1AA" },
};

const CH_PROFILES: Record<string, Record<string, unknown>> = {
  [CH.northwind]: {
    company_name: "NORTHWIND TRADING LIMITED",
    company_number: CH.northwind,
    company_status: "active",
    date_of_creation: "1999-05-17",
    registered_office_address: { locality: "LONDON", country: "England", postal_code: "EC1A 1BB" },
    sic_codes: ["62012"],
  },
  "06666666": { company_name: "SOCIAL ONLY LIMITED", company_number: "06666666", company_status: "active" },
  [CH.dissolved]: {
    company_name: "DEAD CO LIMITED",
    company_number: CH.dissolved,
    company_status: "dissolved",
    date_of_creation: "2001-01-01",
  },
  [CH.optedOut]: {
    company_name: "OPTED OUT LTD",
    company_number: CH.optedOut,
    company_status: "active",
    date_of_creation: "2010-01-01",
  },
  [CH.quill]: {
    company_name: "QUILLFEATHER WIDGETS LIMITED",
    company_number: CH.quill,
    company_status: "active",
    date_of_creation: "2015-02-03",
    registered_office_address: { locality: "Leeds", country: "England" },
  },
};

const CH_OFFICERS: Record<string, unknown[]> = {
  [CH.northwind]: [
    { name: "SMITH, John Michael", officer_role: "director", appointed_on: "2010-01-01", ...PERSONAL },
    { name: "O'BRIEN, Dr Siobhan", officer_role: "secretary", appointed_on: "2012-01-01", ...PERSONAL },
    { name: "VAN DER BERG, Anna", officer_role: "llp-designated-member", appointed_on: "2018-01-01", ...PERSONAL },
    {
      name: "JONES, Former",
      officer_role: "director",
      appointed_on: "2001-01-01",
      resigned_on: "2019-06-30",
      ...PERSONAL,
    },
    {
      name: "ACME SECRETARIES LIMITED",
      officer_role: "corporate-secretary",
      appointed_on: "2005-01-01",
      identification: { registration_number: "00000001" },
    },
  ],
  [CH.optedOut]: [{ name: "HIDDEN, Person", officer_role: "director", ...PERSONAL }],
  [CH.quill]: [{ name: "FEATHER, Quentin", officer_role: "director", appointed_on: "2015-02-03", ...PERSONAL }],
};

function chRoute(url: URL): { status: number; body: unknown } {
  const path = url.pathname;
  if (path === "/advanced-search/companies") {
    const names: Record<string, string> = {
      [CH.quill]: "QUILLFEATHER WIDGETS LIMITED",
      [CH.noweb]: "NOWEB SOLUTIONS LIMITED",
      [CH.twin]: "TWINLEAF LTD",
    };
    const items = Object.entries(names).map(([n, name]) => ({
      company_number: n,
      company_name: name,
      company_status: "active",
    }));
    const start = Number(url.searchParams.get("start_index") ?? "0");
    return { status: 200, body: { hits: items.length, items: items.slice(start, start + 100) } };
  }
  const officers = path.match(/^\/company\/([A-Z0-9]+)\/officers$/);
  if (officers?.[1]) {
    const items = CH_OFFICERS[officers[1]];
    return items
      ? { status: 200, body: { items, total_results: items.length, active_count: items.length } }
      : { status: 404, body: { errors: [{ error: "company-officers-not-found" }] } };
  }
  const profile = path.match(/^\/company\/([A-Z0-9]+)$/);
  if (profile?.[1]) {
    const body = CH_PROFILES[profile[1]];
    return body ? { status: 200, body } : { status: 404, body: { errors: [{ error: "company-profile-not-found" }] } };
  }
  return { status: 404, body: {} };
}

function ownershipXml(owners: Array<{ name: string; officer?: string; director?: boolean; tenPercent?: boolean }>) {
  const blocks = owners.map(
    (o) => `<reportingOwner>
      <reportingOwnerId><rptOwnerCik>0001</rptOwnerCik><rptOwnerName>${o.name}</rptOwnerName></reportingOwnerId>
      <reportingOwnerAddress><rptOwnerStreet1>1 PRIVATE LANE</rptOwnerStreet1><rptOwnerCity>BOSTON</rptOwnerCity></reportingOwnerAddress>
      <reportingOwnerRelationship>
        <isDirector>${o.director ? "1" : "0"}</isDirector>
        <isOfficer>${o.officer ? "true" : "false"}</isOfficer>
        <isTenPercentOwner>${o.tenPercent ? "1" : "0"}</isTenPercentOwner>
        <isOther>0</isOther>
        ${o.officer ? `<officerTitle>${o.officer}</officerTitle>` : ""}
      </reportingOwnerRelationship>
    </reportingOwner>`,
  );
  return `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType>${blocks.join("")}</ownershipDocument>`;
}

const SEC_FILINGS: Record<string, string> = {
  "/Archives/edgar/data/9900001/000990000126000001/form4.xml": ownershipXml([
    { name: "DOE JANE A", officer: "EVP, CHIEF FINANCIAL OFFICER" },
    { name: "BIG FUND LP", tenPercent: true },
  ]),
  "/Archives/edgar/data/9900001/000990000126000002/form4.xml": ownershipXml([
    { name: "ROE RICHARD", director: true },
    { name: "Doe Jane A", officer: "Chief Financial Officer" },
  ]),
  "/Archives/edgar/data/9900001/000990000123000003/form4.xml": ownershipXml([
    { name: "OLDMAN OSCAR", officer: "Chief Operating Officer" },
  ]),
  "/Archives/edgar/data/9900002/000990000226000001/form4.xml": ownershipXml([
    { name: "LANTERN LUCY", officer: "Chief Executive Officer", director: true },
  ]),
};

function submissions(cik: string): unknown | null {
  const recent = (rows: Array<[string, string, string, string]>) => ({
    accessionNumber: rows.map((r) => r[0]),
    filingDate: rows.map((r) => r[1]),
    form: rows.map((r) => r[2]),
    primaryDocument: rows.map((r) => r[3]),
  });
  if (cik === CIK.harbor) {
    return {
      cik: "0009900001",
      name: "Harbor Robotics Inc.",
      sicDescription: "Industrial Robots",
      website: "",
      addresses: { business: { street1: "1 HARBOR WAY", city: "BOSTON", stateOrCountry: "MA" } },
      filings: {
        recent: recent([
          ["0009900001-26-000002", daysAgo(5), "4", "xslF345X05/form4.xml"],
          ["0009900001-26-000009", daysAgo(6), "10-K", "harbor-10k.htm"],
          ["0009900001-26-000001", daysAgo(40), "4", "xslF345X05/form4.xml"],
          ["0009900001-23-000003", daysAgo(1_100), "4", "xslF345X05/form4.xml"],
        ]),
      },
    };
  }
  if (cik === CIK.lighthouse) {
    return {
      cik: "0009900002",
      name: "Lighthouse Analytics Corp",
      sicDescription: "Services-Prepackaged Software",
      website: regHost("lighthouse"),
      addresses: { business: { city: "TORONTO", stateOrCountry: "A6", country: "Canada" } },
      filings: { recent: recent([["0009900002-26-000001", daysAgo(10), "4", "xslF345X05/form4.xml"]]) },
    };
  }
  if (cik === CIK.nowhere) {
    return {
      cik: "0009900003",
      name: "Nowhere Holdings Zzq",
      website: "",
      addresses: { business: { city: "AUSTIN", stateOrCountry: "TX" } },
      filings: { recent: recent([["0009900003-26-000001", daysAgo(3), "4", "xslF345X05/form4.xml"]]) },
    };
  }
  return null;
}

type Routed = { status: number; type: string; body: string };

function route(host: string, url: URL): Routed {
  const site = host.split(":")[0]?.replace(/-reg\.localhost$/, "") ?? "";
  const json = (status: number, body: unknown): Routed => ({
    status,
    type: "application/json",
    body: JSON.stringify(body),
  });
  if (site === "wd" && url.pathname === "/sparql") return json(200, sparql(url.searchParams.get("query") ?? ""));
  if (site === "ch") {
    const out = chRoute(url);
    return json(out.status, out.body);
  }
  if (site === "sec") {
    if (url.pathname === "/files/company_tickers.json") {
      return json(200, {
        "0": { cik_str: Number(CIK.harbor), ticker: "HRBR", title: "HARBOR ROBOTICS INC" },
        "1": { cik_str: Number(CIK.lighthouse), ticker: "LTHS", title: "Lighthouse Analytics Corp" },
        "2": { cik_str: Number(CIK.lighthouse), ticker: "LTHS-B", title: "Lighthouse Analytics Corp" },
        "3": { cik_str: Number(CIK.nowhere), ticker: "NWHR", title: "Nowhere Holdings Zzq" },
      });
    }
    const xml = SEC_FILINGS[url.pathname];
    return xml ? { status: 200, type: "text/xml", body: xml } : json(404, {});
  }
  if (site === "secdata") {
    const cik = url.pathname.match(/^\/submissions\/CIK(\d{10})\.json$/)?.[1]?.replace(/^0+/, "");
    const body = cik ? submissions(cik) : null;
    return body ? json(200, body) : json(404, {});
  }
  return { status: 404, type: "text/plain", body: "not found" };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const host = String(req.headers.host ?? "").toLowerCase();
  const url = new URL(req.url ?? "/", `http://${host || "localhost"}`);
  if (host.startsWith("control-reg.localhost")) {
    if (url.pathname === "/__ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("registry-fixtures");
    }
    if (url.pathname === "/__log") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(log));
    }
  }
  log.push({
    host,
    path: url.pathname + url.search,
    userAgent: String(req.headers["user-agent"] ?? ""),
    authorization: String(req.headers.authorization ?? ""),
  });
  const out = route(host, url);
  res.writeHead(out.status, { "content-type": out.type });
  res.end(out.body);
}

async function alreadyServing(): Promise<boolean> {
  try {
    const res = await fetch(`${CONTROL}/__ping`);
    return res.ok && (await res.text()) === "registry-fixtures";
  } catch {
    return false;
  }
}

export async function startRegistryFixtures(): Promise<{ close: () => Promise<void> }> {
  const noop = { close: () => Promise.resolve() };
  if (await alreadyServing()) return noop;
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
    server.listen({ port: REG_PORT, host: "::", ipv6Only: false }, () => resolve(true));
  });
  if (!started) return noop;
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export async function registryLog(): Promise<RegRequest[]> {
  const res = await fetch(`${CONTROL}/__log`);
  return (await res.json()) as RegRequest[];
}
