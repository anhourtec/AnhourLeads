/**
 * RSS / Atom feeds (company news) and XML sitemaps. Regex based and dependency-free, like the HTML
 * extractor: entities are decoded, CDATA unwrapped, nothing is executed. Pure.
 */

import { decodeEntities, findTags } from "../crawler/extract";
import { normalizeUrl } from "../crawler/url";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: Date | null;
}

const MAX_ITEMS = 50;

function unwrap(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const raw = cdata ? (cdata[1] ?? "") : value.replace(/<[^>]+>/g, " ");
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

function tagText(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, "i"));
  const value = m?.[1] !== undefined ? unwrap(m[1]) : "";
  return value || null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Items of an RSS 2.0 / RSS 1.0 or Atom feed, newest first, with absolute http(s) links. */
export function parseFeed(xml: string, baseUrl: string): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const push = (title: string | null, link: string | null, published: string | null) => {
    if (!title || !link) return;
    const url = normalizeUrl(link, baseUrl);
    if (!url || seen.has(url.toString())) return;
    seen.add(url.toString());
    out.push({ title: title.slice(0, 300), url: url.toString(), publishedAt: parseDate(published) });
  };

  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const block = m[1] ?? "";
    push(
      tagText(block, "title"),
      tagText(block, "link") ?? tagText(block, "guid"),
      tagText(block, "pubDate") ?? tagText(block, "dc:date"),
    );
    if (out.length >= MAX_ITEMS) break;
  }
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)) {
    const block = m[1] ?? "";
    const links = findTags(block, "link");
    const link = links.find((l) => !l.rel || l.rel === "alternate")?.href ?? links[0]?.href ?? null;
    push(tagText(block, "title"), link, tagText(block, "published") ?? tagText(block, "updated"));
    if (out.length >= MAX_ITEMS) break;
  }
  return out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}

export interface Sitemap {
  /** Page URLs (from a urlset). */
  urls: string[];
  /** Child sitemaps (from a sitemapindex). */
  sitemaps: string[];
}

/** Locations listed in a sitemap or sitemap index (capped). */
export function parseSitemap(xml: string, baseUrl: string, max = 5_000): Sitemap {
  const locs = (block: string) =>
    [...block.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)]
      .map((m) => normalizeUrl(unwrap(m[1] ?? ""), baseUrl)?.toString())
      .filter((u): u is string => Boolean(u))
      .slice(0, max);
  if (/<sitemapindex\b/i.test(xml)) return { urls: [], sitemaps: locs(xml) };
  return { urls: locs(xml), sitemaps: [] };
}

/** Feeds a page advertises with `<link rel="alternate" type="application/rss+xml|atom+xml">`. */
export function feedLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const attrs of findTags(html, "link")) {
    const rel = (attrs.rel ?? "").toLowerCase();
    const type = (attrs.type ?? "").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate")) continue;
    if (type !== "application/rss+xml" && type !== "application/atom+xml") continue;
    const url = attrs.href ? normalizeUrl(attrs.href, baseUrl) : null;
    if (url) out.add(url.toString());
  }
  return [...out].slice(0, 3);
}
