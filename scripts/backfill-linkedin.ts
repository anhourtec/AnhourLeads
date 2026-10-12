/**
 * Recover the LinkedIn profile links companies publish next to their people, for people indexed
 * before the crawler kept them. Nothing is fetched here: the pages that listed people without a
 * profile link are put back in the crawl queue, and the running crawler re-reads them at its own
 * polite pace (robots.txt, per-host delay). linkedin.com itself is never queued or fetched.
 *
 *   npm run index:backfill-linkedin              # re-queue the pages
 *   npm run index:backfill-linkedin -- --dry-run # only count them
 *   npm run index:backfill-linkedin -- --older-than-hours 6
 *
 * Idempotent: only pages that are done and were fetched more than `--older-than-hours` ago
 * (default 1) are re-queued. Pages still waiting in the queue are not touched, and pages the crawler
 * has just re-read are skipped, so running it again changes nothing; re-reading a page never
 * erases a stored profile. Reserved test hosts (`localhost`, `*.test`…) are left alone.
 */

import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) process.loadEnvFile(".env");

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../src/server/db");
  const { RESERVED_HOST_PATTERN } = await import("../src/server/discovery/classify");

  const dryRun = process.argv.includes("--dry-run");
  const hours = Number(option("--older-than-hours") ?? 1);
  if (!Number.isFinite(hours) || hours < 0) throw new Error("--older-than-hours must be a number of hours");

  // Pages (by URL) that listed at least one current, crawled person without a profile link.
  const pages = sql`
    select distinct p.source_url as url
    from index_person p
    where p.source = 'crawl' and p.linkedin_url is null and p.gone_at is null`;
  const due = sql`
    f.status = 'done'
    and f.url in (${pages})
    and (f.fetched_at is null or f.fetched_at < now() - make_interval(hours => ${hours}))
    and f.host !~* ${RESERVED_HOST_PATTERN}`;

  const before = await db.execute<{ with_linkedin: number; people: number }>(
    sql`select count(*) filter (where linkedin_url is not null)::int as with_linkedin, count(*)::int as people from index_person`,
  );
  const stats = before.rows[0];
  console.log(`index_person: ${stats?.people ?? 0} people, ${stats?.with_linkedin ?? 0} with a LinkedIn profile`);

  if (dryRun) {
    const count = await db.execute<{ n: number }>(sql`select count(*)::int as n from crawl_frontier f where ${due}`);
    console.log(`index:backfill-linkedin (dry run): ${count.rows[0]?.n ?? 0} pages would be re-queued`);
    return;
  }
  const requeued = await db.execute<{ id: string }>(
    sql`update crawl_frontier f
        set status = 'queued', next_attempt_at = now(), attempts = 0
        where ${due}
        returning f.id`,
  );
  console.log(`index:backfill-linkedin: ${requeued.rows.length} pages re-queued for the crawler`);
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("index:backfill-linkedin failed:", error.message);
    process.exit(1);
  });
