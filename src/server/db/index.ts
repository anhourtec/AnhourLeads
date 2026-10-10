import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/server/env";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { anhourPool?: Pool; anhourDb?: Database };

function create(): Database {
  globalForDb.anhourPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return drizzle(globalForDb.anhourPool, { schema });
}

/** Shared Drizzle client. One pool per process, kept on globalThis to survive dev HMR. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    globalForDb.anhourDb ??= create();
    return Reflect.get(globalForDb.anhourDb, prop, receiver);
  },
});

export { schema };
