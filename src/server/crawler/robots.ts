/**
 * robots.txt parsing and matching (RFC 9309). Pure: callers fetch the file.
 *
 * - The group(s) naming our product token apply; otherwise the `*` group(s); otherwise no rules.
 * - The longest matching Allow/Disallow pattern wins; on a tie Allow wins.
 * - `*` matches any sequence and a trailing `$` anchors the end.
 * - Crawl-delay (non-standard but widely used) is honoured by the crawler.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** "rules": apply `rules`; "allow_all": no robots.txt (4xx); "disallow_all": unreachable (5xx / network). */
  mode: "rules" | "allow_all" | "disallow_all";
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
  /** Which group applied: our product token, "*", or none. */
  matchedAgent: string | null;
}

export const ALLOW_ALL: RobotsPolicy = {
  mode: "allow_all",
  rules: [],
  crawlDelaySeconds: null,
  sitemaps: [],
  matchedAgent: null,
};
export const DISALLOW_ALL: RobotsPolicy = {
  mode: "disallow_all",
  rules: [],
  crawlDelaySeconds: null,
  sitemaps: [],
  matchedAgent: null,
};

/** "AnhourLeadsBot/0.1 (+https://…)" → "anhourleadsbot". */
export function productToken(userAgent: string): string {
  return (userAgent.trim().split(/[\s/;(]/)[0] ?? "").toLowerCase();
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

function matchedAgentOf(named: boolean, any: boolean, token: string): string | null {
  if (named) return token;
  return any ? "*" : null;
}

/** Parse robots.txt for a user agent. Unknown lines are ignored; files are capped at 500 KiB per RFC 9309. */
export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const token = productToken(userAgent);
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.slice(0, 500 * 1024).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }

  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && productToken(a) === token));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return {
    mode: "rules",
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: delays.length ? Math.max(...delays) : null,
    sitemaps,
    matchedAgent: matchedAgentOf(named.length > 0, chosen.length > 0, token),
  };
}

/** Normalise percent-encoding so "/a%2fb" and "/a%2Fb" compare equal and "%7E" equals "~". */
function normalizeEncoding(path: string): string {
  return path.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = normalizeEncoding(anchored ? pattern.slice(0, -1) : pattern);
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** Whether a path (with query string) may be fetched under the policy. */
export function isAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  if (policy.mode === "allow_all") return true;
  const path = normalizeEncoding(pathWithQuery || "/");
  if (path === "/robots.txt") return true;
  if (policy.mode === "disallow_all") return false;
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
