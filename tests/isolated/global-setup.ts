import { Client } from "pg";

import { execSync } from "node:child_process";

/**
 * Create the isolated database if it's missing, migrate it and seed it from scratch, including an
 * empty discovery index. Never touches the shared dev database.
 */
export default async function globalSetup() {
  const env = JSON.parse(process.env.ISOLATED_ENV ?? "{}") as Partial<Record<string, string>>;
  const url = new URL(env.DATABASE_URL ?? "");
  const name = url.pathname.slice(1);
  if (!/^anhourleads_isolated\w*$/.test(name)) throw new Error(`refusing to reset ${name}: not an isolated database`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
  if (!exists.rowCount) await client.query(`create database "${name}"`);
  await client.end();

  const childEnv = { ...process.env, ...env };
  execSync("npm run --silent db:migrate", { stdio: "inherit", env: childEnv });
  execSync("npm run --silent db:seed -- --reset --reset-index", { stdio: "inherit", env: childEnv });
}
