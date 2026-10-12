/**
 * Public job boards (applicant tracking systems). A company's careers page links its board, e.g.
 * boards.greenhouse.io/<token>; the crawler never fetches the board pages, only each provider's
 * documented public JSON API for that token. Pure: detection, API URLs and response parsing.
 */

import { departmentFromTitle } from "./classify";

export const ATS_PROVIDERS = ["greenhouse", "lever", "ashby", "workable"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export interface AtsBoard {
  provider: AtsProvider;
  token: string;
}

/** Base URL of each provider's public API. Platform admins may point these elsewhere (tests use a fixture). */
export const DEFAULT_ATS_ENDPOINTS: Record<AtsProvider, string> = {
  greenhouse: "https://boards-api.greenhouse.io",
  lever: "https://api.lever.co",
  ashby: "https://api.ashbyhq.com",
  workable: "https://apply.workable.com",
};

export type AtsEndpoints = Partial<Record<AtsProvider, string>>;

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** The board a link points to, or null. Only the board's home (or a job on it) counts. */
export function atsBoardFromUrl(href: string): AtsBoard | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  const board = (provider: AtsProvider, token: string | null | undefined): AtsBoard | null =>
    token && TOKEN.test(token) ? { provider, token: token.toLowerCase() } : null;

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (first === "embed") return board("greenhouse", url.searchParams.get("for"));
    return board("greenhouse", first);
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return board("lever", first);
  if (host === "jobs.ashbyhq.com") return board("ashby", first);
  if (host === "apply.workable.com") return first === "api" ? null : board("workable", first);
  return null;
}

/** Every distinct board linked from a page. */
export function detectAtsBoards(links: string[]): AtsBoard[] {
  const out = new Map<string, AtsBoard>();
  for (const link of links) {
    const b = atsBoardFromUrl(link);
    if (b) out.set(`${b.provider}:${b.token}`, b);
  }
  return [...out.values()];
}

const API_PATHS: Record<AtsProvider, (token: string) => string> = {
  greenhouse: (t) => `/v1/boards/${encodeURIComponent(t)}/jobs`,
  lever: (t) => `/v0/postings/${encodeURIComponent(t)}?mode=json`,
  ashby: (t) => `/posting-api/job-board/${encodeURIComponent(t)}`,
  workable: (t) => `/api/v1/widget/accounts/${encodeURIComponent(t)}`,
};

/** The public API URL for a board, against the configured (or default) base. */
export function atsApiUrl(board: AtsBoard, endpoints: AtsEndpoints = {}): string {
  const base = (endpoints[board.provider] ?? DEFAULT_ATS_ENDPOINTS[board.provider]).replace(/\/+$/, "");
  return `${base}${API_PATHS[board.provider](board.token)}`;
}

const API_PATTERNS: Array<[RegExp, AtsProvider]> = [
  [/\/v1\/boards\/([^/]+)\/jobs$/, "greenhouse"],
  [/\/v0\/postings\/([^/]+)$/, "lever"],
  [/\/posting-api\/job-board\/([^/]+)$/, "ashby"],
  [/\/api\/v1\/widget\/accounts\/([^/]+)$/, "workable"],
];

/** Which board an API URL (as built by atsApiUrl) reads. */
export function atsBoardFromApiUrl(href: string): AtsBoard | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const [pattern, provider] of API_PATTERNS) {
    const token = url.pathname.match(pattern)?.[1];
    if (token) return { provider, token: decodeURIComponent(token).toLowerCase() };
  }
  return null;
}

export interface AtsJob {
  title: string;
  department: string | null;
  location: string | null;
  url: string;
  postedAt: Date | null;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: Json | undefined): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : null;
};
const httpUrl = (v: Json | undefined): string | null => {
  const s = text(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const date = (v: Json | undefined): Date | null => {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const list = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);

const MAX_JOBS = 500;

function finish(jobs: Array<AtsJob | null>): AtsJob[] {
  const seen = new Set<string>();
  const out: AtsJob[] = [];
  for (const job of jobs) {
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    out.push({ ...job, department: job.department ?? departmentFromTitle(job.title) });
    if (out.length >= MAX_JOBS) break;
  }
  return out;
}

export function parseGreenhouse(body: Json): AtsJob[] {
  const jobs = isObject(body) ? list(body.jobs) : [];
  return finish(
    jobs.map((j) => {
      if (!isObject(j)) return null;
      const title = text(j.title);
      const url = httpUrl(j.absolute_url);
      if (!title || !url) return null;
      const dept = list(j.departments).find(isObject);
      return {
        title,
        url,
        department: dept && isObject(dept) ? text(dept.name) : null,
        location: isObject(j.location) ? text(j.location.name) : null,
        postedAt: date(j.first_published ?? j.updated_at),
      };
    }),
  );
}

export function parseLever(body: Json): AtsJob[] {
  return finish(
    list(body).map((j) => {
      if (!isObject(j)) return null;
      const title = text(j.text);
      const url = httpUrl(j.hostedUrl);
      if (!title || !url) return null;
      const c = isObject(j.categories) ? j.categories : {};
      return {
        title,
        url,
        department: text(c.department) ?? text(c.team),
        location: text(c.location),
        postedAt: date(j.createdAt),
      };
    }),
  );
}

export function parseAshby(body: Json): AtsJob[] {
  const jobs = isObject(body) ? list(body.jobs) : [];
  return finish(
    jobs.map((j) => {
      if (!isObject(j) || j.isListed === false) return null;
      const title = text(j.title);
      const url = httpUrl(j.jobUrl) ?? httpUrl(j.applyUrl);
      if (!title || !url) return null;
      return {
        title,
        url,
        department: text(j.department) ?? text(j.team),
        location: text(j.location),
        postedAt: date(j.publishedAt),
      };
    }),
  );
}

export function parseWorkable(body: Json): AtsJob[] {
  const jobs = isObject(body) ? list(body.jobs) : [];
  return finish(
    jobs.map((j) => {
      if (!isObject(j)) return null;
      const title = text(j.title);
      const url = httpUrl(j.url) ?? httpUrl(j.shortlink);
      if (!title || !url) return null;
      const location = [text(j.city), text(j.state), text(j.country)].filter(Boolean).join(", ") || null;
      return { title, url, department: text(j.department), location, postedAt: date(j.published_on ?? j.created_at) };
    }),
  );
}

/** Parse a provider's JSON response. Malformed bodies give an empty list, never an error. */
export function parseAtsJobs(provider: AtsProvider, raw: string): AtsJob[] {
  let body: Json;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    return [];
  }
  switch (provider) {
    case "greenhouse":
      return parseGreenhouse(body);
    case "lever":
      return parseLever(body);
    case "ashby":
      return parseAshby(body);
    case "workable":
      return parseWorkable(body);
  }
}

/** Display name of a provider, stored as index_job_posting.source. */
export const ATS_LABELS: Record<AtsProvider, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
};
