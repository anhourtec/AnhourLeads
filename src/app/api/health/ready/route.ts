import { NextResponse } from "next/server";

import { sql } from "drizzle-orm";

import { db } from "@/server/db";
import { redis } from "@/server/redis";

async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** Readiness: Postgres (critical) and Redis (critical when configured). 503 when either is down. */
export async function GET() {
  const checks: Record<string, "ok" | "down" | "disabled"> = {};
  try {
    await within(2000, db.execute(sql`select 1`));
    checks.postgres = "ok";
  } catch {
    checks.postgres = "down";
  }
  const client = redis();
  if (!client) checks.redis = "disabled";
  else {
    try {
      await within(2000, client.ping());
      checks.redis = "ok";
    } catch {
      checks.redis = "down";
    }
  }
  const ok = !Object.values(checks).includes("down");
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
