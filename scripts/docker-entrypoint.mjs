#!/usr/bin/env node

/**
 * Container entrypoint for the AnhourLeads image (deploy/Dockerfile → CMD).
 *
 *   node scripts/docker-entrypoint.mjs            # check settings, wait for Postgres + Redis, migrate, start the app
 *   node scripts/docker-entrypoint.mjs migrate    # same checks, apply migrations, exit (one-off task / Kubernetes Job)
 *
 * Environment:
 *   SKIP_MIGRATIONS=true   don't migrate on start (clusters: run `migrate` once per release instead, so
 *                          replicas never race each other)
 *   STARTUP_WAIT_SECONDS   how long to wait for Postgres / Redis (default 60)
 *
 * A misconfigured container fails at start with a message naming the missing setting, not later on
 * the first request. Logs are JSON lines like the app's. Secrets are never printed; connection
 * strings are logged with the password masked.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Redis from "ioredis";
import pg from "pg";

import { spawn } from "node:child_process";

const PORT = 3410;
const mode = process.argv[2] === "migrate" ? "migrate" : "start";

function log(level, msg, fields = {}) {
  const line = { time: new Date().toISOString(), level, msg, component: "entrypoint", mode, ...fields };
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
}

const mask = (url) => String(url ?? "").replace(/\/\/([^:/@]*):[^@]*@/, "//$1:***@");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Required settings. Names and reasons only: values are never logged. */
function checkConfig() {
  const env = process.env;
  const missing = [];
  const need = (name, ok, reason, example) => {
    if (ok) log("info", "setting ok", { name });
    else missing.push({ name, reason, example });
  };
  need("DATABASE_URL", Boolean(env.DATABASE_URL), "nothing can be stored", "postgres://user:password@host:5432/db");
  need(
    "REDIS_URL",
    Boolean(env.REDIS_URL),
    "caches, rate limits and locks need Redis",
    "redis://:password@host:6379/0",
  );
  need(
    "BETTER_AUTH_SECRET",
    (env.BETTER_AUTH_SECRET ?? "").length >= 32,
    "sign-in needs a session signing secret of 32+ characters",
    "openssl rand -base64 48",
  );
  need(
    "APP_PRIMARY_HOSTS",
    Boolean(env.APP_PRIMARY_HOSTS),
    "the installation doesn't know its own hostnames",
    "leads.example.com",
  );
  need(
    "BETTER_AUTH_URL",
    Boolean(env.BETTER_AUTH_URL) && !/localhost/.test(env.BETTER_AUTH_URL ?? ""),
    "the public origin of the primary host is needed for sign-in links",
    "https://leads.example.com",
  );
  if (!env.SECRETS_ENCRYPTION_KEY) {
    log("warn", "SECRETS_ENCRYPTION_KEY is not set: stored secrets are encrypted with a key derived from BETTER_AUTH_SECRET, so rotating that secret makes saved mailbox passwords unreadable", {
      name: "SECRETS_ENCRYPTION_KEY",
    });
  }
  if (env.APP_PROTOCOL === "https" && (env.APP_TLS_PROVIDER ?? "none") === "none") {
    log("warn", "APP_TLS_PROVIDER=none in production: workspace hostnames won't show certificate status", {
      name: "APP_TLS_PROVIDER",
    });
  }
  if (!env.APP_DOMAIN_TARGET) {
    log("warn", "APP_DOMAIN_TARGET is not set: workspaces are told to point their CNAME at the first primary host", {
      name: "APP_DOMAIN_TARGET",
    });
  }
  if (env.CRAWLER_ALLOW_PRIVATE_HOSTS === "true") {
    log("warn", "CRAWLER_ALLOW_PRIVATE_HOSTS=true is for tests only", { name: "CRAWLER_ALLOW_PRIVATE_HOSTS" });
  }
  if (missing.length > 0) {
    for (const m of missing) log("error", "required setting missing", m);
    throw new Error(`${missing.length} required setting(s) missing; refusing to start`);
  }
}

async function waitFor(name, attemptOnce) {
  const deadline = Date.now() + Number(process.env.STARTUP_WAIT_SECONDS ?? 60) * 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await attemptOnce();
      log("info", `${name} is ready`, { attempt });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`${name} not reachable: ${error.message}`);
      log("warn", `${name} not ready yet`, { attempt, error: error.message });
      await sleep(2000);
    }
  }
}

function waitForPostgres() {
  log("info", "waiting for Postgres", { url: mask(process.env.DATABASE_URL) });
  return waitFor("postgres", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query("select 1");
    } finally {
      await client.end().catch(() => undefined);
    }
  });
}

function waitForRedis() {
  log("info", "waiting for Redis", { url: mask(process.env.REDIS_URL) });
  return waitFor("redis", async () => {
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 5000,
      enableOfflineQueue: false,
    });
    try {
      await redis.connect();
      if ((await redis.ping()) !== "PONG") throw new Error("unexpected PING reply");
    } finally {
      redis.disconnect();
    }
  });
}

/** Apply drizzle/ migrations (the same folder `npm run db:migrate` uses). */
async function applyMigrations() {
  log("info", "applying database migrations");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
  log("info", "migrations applied");
}

/** Start the app and pass SIGTERM / SIGINT through so it stops gracefully. */
function startApp() {
  log("info", "starting AnhourLeads", { port: PORT });
  const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "0.0.0.0"], {
    stdio: "inherit",
    env: process.env,
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      log("info", "stopping", { signal });
      child.kill(signal);
    });
  }
  child.on("close", (code, signal) => {
    log(code === 0 || signal ? "info" : "error", "app exited", { exitCode: code, signal });
    process.exit(code ?? 0);
  });
}

async function main() {
  try {
    checkConfig();
    await waitForPostgres();
    await waitForRedis();
    if (mode === "migrate") {
      await applyMigrations();
      process.exit(0);
    }
    if (process.env.SKIP_MIGRATIONS === "true") log("info", "skipping migrations (SKIP_MIGRATIONS=true)");
    else await applyMigrations();
    startApp();
  } catch (error) {
    log("error", "start-up failed", { error: error.message });
    process.exit(1);
  }
}

void main();
