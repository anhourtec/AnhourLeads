import "server-only";

import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3410"),
  APP_PRIMARY_HOSTS: z.string().default("localhost:3410,127.0.0.1:3410"),
  APP_DOMAIN_TARGET: z.string().optional(),
  APP_PROTOCOL: z.enum(["http", "https"]).default("http"),
  APP_TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  APP_TLS_PROVIDER: z.enum(["nginx", "cloudflare", "none"]).default("none"),
  APP_ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("AnhourLeads <no-reply@anhourleads.local>"),
  CRAWLER_USER_AGENT: z.string().default("AnhourLeadsBot/0.1"),
  CRAWLER_ALLOW_PRIVATE_HOSTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Parsed lazily so `next build` doesn't need runtime secrets. */
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

/** Primary hostnames (lowercase, with optional port) that serve the installation's own brand. */
export function primaryHosts(): string[] {
  return env()
    .APP_PRIMARY_HOSTS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
