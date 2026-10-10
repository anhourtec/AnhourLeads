import { classifyIp, isIpLiteral } from "./ip";
import type { SkipReason } from "./types";
import { cleanHost, normalizeUrl } from "./url";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";

/**
 * A guarded HTTP GET for the crawler:
 *  - http/https only, no credentials in URLs;
 *  - every hostname is resolved and every address checked against the SSRF guard (private,
 *    loopback, link-local/metadata, CGNAT, multicast…) at connect time, so DNS rebinding can't
 *    swap in a private address after the check;
 *  - redirects are followed manually (≤ maxRedirects), each hop re-validated and offered to
 *    `checkHop` (same-site and robots checks);
 *  - a hard timeout, a byte cap on the decoded body and a content-type allow-list.
 * Never sends cookies or credentials and never submits anything.
 */
export interface SafeFetchOptions {
  userAgent: string;
  allowPrivate: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** "html" accepts text/html and XHTML only; "text" accepts text/plain (robots.txt). */
  expect: "html" | "text";
  /** Called for every redirect target. Return a skip reason to stop there. */
  checkHop?: (url: URL) => Promise<SkipReason | null>;
}

export type SafeFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      headers: Partial<Record<string, string>>;
      body: string;
      redirects: number;
    }
  | { ok: false; url: string; status: number | null; reason: SkipReason; detail?: string };

class BlockedHostError extends Error {
  code = "EBLOCKEDHOST";
}

/** A lookup that refuses any non-public address (unless private hosts are allowed). */
export function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, "", 4);
      if (!addresses.length) return callback(Object.assign(new Error("no addresses"), { code: "ENOTFOUND" }), "", 4);
      if (!allowPrivate) {
        const bad = addresses.find((a) => classifyIp(a.address) !== "public");
        if (bad) return callback(new BlockedHostError(`${hostname} resolves to a non-public address`), "", 4);
      }
      if (options.all) {
        (callback as unknown as (err: null, addrs: LookupAddress[]) => void)(null, addresses);
        return;
      }
      const first = addresses[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

/** Pre-flight check for a URL's host. IP literals never reach the lookup, so they are checked here. */
export function hostBlocked(url: URL, allowPrivate: boolean): boolean {
  if (allowPrivate) return false;
  const host = cleanHost(url.hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isIpLiteral(host) && classifyIp(host) !== "public";
}

function headerMap(res: IncomingMessage): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function acceptable(contentType: string, expect: SafeFetchOptions["expect"]): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (expect === "text") return type === "" || type.startsWith("text/");
  return type === "text/html" || type === "application/xhtml+xml";
}

function charsetOf(contentType: string): string {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    new TextDecoder(charset);
    return charset;
  } catch {
    return "utf-8";
  }
}

function decoded(res: IncomingMessage, encoding: string): NodeJS.ReadableStream & { destroy: () => void } {
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

interface HopResult {
  status: number;
  headers: Partial<Record<string, string>>;
  location: string | null;
  body?: string;
  failure?: { reason: SkipReason; detail?: string };
}

function requestOnce(url: URL, opts: Required<Omit<SafeFetchOptions, "checkHop">>): Promise<HopResult> {
  return new Promise((resolve) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (r: HopResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(opts.allowPrivate),
        headers: {
          "user-agent": opts.userAgent,
          accept: opts.expect === "html" ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" : "text/plain,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en;q=1, *;q=0.5",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = headerMap(res);
        if (status >= 300 && status < 400 && headers.location) {
          res.resume();
          return done({ status, headers, location: headers.location });
        }
        if (status >= 400) {
          res.resume();
          return done({ status, headers, location: null, failure: { reason: "http_error", detail: `HTTP ${status}` } });
        }
        const contentType = headers["content-type"] ?? "";
        if (!acceptable(contentType, opts.expect)) {
          res.destroy();
          return done({ status, headers, location: null, failure: { reason: "not_html", detail: contentType } });
        }
        const declared = Number(headers["content-length"] ?? "0");
        if (declared > opts.maxBytes && !headers["content-encoding"]) {
          res.destroy();
          return done({
            status,
            headers,
            location: null,
            failure: { reason: "too_large", detail: `${declared} bytes` },
          });
        }
        const encoding = (headers["content-encoding"] ?? "").toLowerCase();
        const stream = decoded(res, encoding);
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            if (stream !== res) stream.destroy();
            done({
              status,
              headers,
              location: null,
              failure: { reason: "too_large", detail: `> ${opts.maxBytes} bytes` },
            });
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          const body = new TextDecoder(charsetOf(contentType)).decode(Buffer.concat(chunks));
          done({ status, headers, location: null, body });
        });
        stream.on("error", (error: Error) =>
          done({ status, headers, location: null, failure: { reason: "network", detail: error.message } }),
        );
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ status: 0, headers: {}, location: null, failure: { reason: "timeout", detail: `${opts.timeoutMs} ms` } });
    }, opts.timeoutMs);
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof BlockedHostError || error.code === "EBLOCKEDHOST") {
        return done({
          status: 0,
          headers: {},
          location: null,
          failure: { reason: "blocked_host", detail: error.message },
        });
      }
      const dns = error.code === "ENOTFOUND" || error.code === "EAI_AGAIN" || error.code === "ENODATA";
      done({
        status: 0,
        headers: {},
        location: null,
        failure: { reason: dns ? "dns" : "network", detail: error.code ?? error.message },
      });
    });
    req.end();
  });
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const opts = {
    userAgent: options.userAgent,
    allowPrivate: options.allowPrivate,
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 1_000_000,
    maxRedirects: options.maxRedirects ?? 3,
    expect: options.expect,
  };
  let url = typeof input === "string" ? normalizeUrl(input) : normalizeUrl(input.toString());
  if (!url) return { ok: false, url: String(input), status: null, reason: "http_error", detail: "unsupported URL" };

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    if (hostBlocked(url, opts.allowPrivate)) {
      return { ok: false, url: url.toString(), status: null, reason: "blocked_host" };
    }
    const result = await requestOnce(url, opts);
    if (result.failure) {
      return {
        ok: false,
        url: url.toString(),
        status: result.status || null,
        reason: result.failure.reason,
        detail: result.failure.detail,
      };
    }
    if (result.location) {
      const next = normalizeUrl(result.location, url);
      if (!next)
        return { ok: false, url: url.toString(), status: result.status, reason: "http_error", detail: "bad redirect" };
      if (hop === opts.maxRedirects) break;
      const veto = options.checkHop ? await options.checkHop(next) : null;
      if (veto) return { ok: false, url: next.toString(), status: result.status, reason: veto };
      url = next;
      continue;
    }
    return {
      ok: true,
      url: url.toString(),
      status: result.status,
      headers: result.headers,
      body: result.body ?? "",
      redirects: hop,
    };
  }
  return { ok: false, url: url.toString(), status: null, reason: "too_many_redirects" };
}
