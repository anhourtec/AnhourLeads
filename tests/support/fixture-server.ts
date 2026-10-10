import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

/**
 * A tiny static site for the research crawler tests (tests/fixtures/site), on 127.0.0.1:48090.
 * Besides the files it serves a few dynamic routes: a page over 1 MB, a JSON endpoint without an
 * extension, a same-site redirect, an offsite redirect and generic job pages under /careers/.
 * Start it in beforeAll; if the port is already taken by another worker's copy, that one is reused.
 */
export const FIXTURE_PORT = 48090;
export const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const ROOT = path.resolve(__dirname, "../fixtures/site");

const TYPES: Partial<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".css": "text/css",
  ".js": "text/javascript",
};

export const requestLog: Array<{ path: string; userAgent: string }> = [];

function largePage(): string {
  const row = "<p>Widget model with a long and detailed description for the catalogue.</p>\n";
  return `<!doctype html><html><head><title>Catalogue</title></head><body>${row.repeat(16_000)}</body></html>`;
}

function jobPage(slug: string): string {
  const title = slug.replace(/-/g, " ");
  return `<!doctype html><html><head><title>${title} | Careers</title></head><body><h1>${title}</h1><a href="/careers">All jobs</a></body></html>`;
}

function candidatesFor(pathname: string): string[] {
  if (pathname === "/") return ["index.html"];
  const rel = pathname.slice(1);
  return path.extname(pathname) ? [rel] : [`${rel}.html`, `${rel}/index.html`];
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", FIXTURE_URL);
  requestLog.push({ path: url.pathname, userAgent: String(req.headers["user-agent"] ?? "") });
  const send = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": type, ...headers });
    res.end(body);
  };

  if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "method not allowed");
  if (url.pathname === "/large.html") return send(200, TYPES[".html"] ?? "text/html", largePage());
  if (url.pathname === "/status") return send(200, "application/json", JSON.stringify({ ok: true }));
  if (url.pathname === "/moved") return send(301, "text/plain", "moved", { location: "/about" });
  if (url.pathname === "/redirect-away") {
    return send(302, "text/plain", "away", { location: "http://offsite.example/portal" });
  }
  const job = url.pathname.match(/^\/careers\/([a-z0-9-]+)$/);
  if (job?.[1]) return send(200, TYPES[".html"] ?? "text/html", jobPage(job[1]));

  for (const rel of candidatesFor(url.pathname)) {
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT)) break;
    try {
      const body = await readFile(file);
      return send(200, TYPES[path.extname(file)] ?? "application/octet-stream", body);
    } catch {
      // Try the next candidate.
    }
  }
  send(404, TYPES[".html"] ?? "text/html", "<!doctype html><title>Not found</title><p>Not found</p>");
}

async function alreadyServing(): Promise<boolean> {
  try {
    const res = await fetch(`${FIXTURE_URL}/robots.txt`);
    return res.ok && (await res.text()).includes("Fixture robots.txt");
  } catch {
    return false;
  }
}

export interface FixtureServer {
  url: string;
  /** False when another worker's server was reused. */
  started: boolean;
  close: () => Promise<void>;
}

/** Another worker owns the server; leave closing to it. */
function reused(): FixtureServer {
  return { url: FIXTURE_URL, started: false, close: () => Promise.resolve() };
}

export async function startFixtureServer(): Promise<FixtureServer> {
  if (await alreadyServing()) return reused();
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
    server.listen(FIXTURE_PORT, "127.0.0.1", () => resolve(true));
  });
  if (!started) return reused();
  return {
    url: FIXTURE_URL,
    started: true,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
