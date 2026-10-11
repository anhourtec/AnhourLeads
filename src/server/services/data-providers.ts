import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { decryptSecret, encryptSecret, secretHint } from "@/server/crypto/secrets";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { log } from "@/server/log";
import {
  type CompanyResult,
  type PersonQuery,
  type PersonResult,
  PROVIDER_IDS,
  PROVIDER_ORDER,
  ProviderError,
  type ProviderId,
  providerClient,
} from "@/server/providers";

import { audit } from "./audit";

/**
 * A workspace's own data-provider keys (bring your own data). Keys are stored encrypted and never
 * returned: lists show the last four characters only. Provider results are written to this
 * workspace's records only, never to the installation-wide discovery index.
 */

export const dataProviderCreateSchema = z.strictObject({
  provider: z.enum(PROVIDER_IDS),
  apiKey: z
    .string()
    .trim()
    .min(8, "Paste the full API key.")
    .max(500)
    .regex(/^[\x21-\x7e]+$/, "An API key has no spaces or special characters."),
  enabled: z.boolean().optional(),
});

export const dataProviderUpdateSchema = z.strictObject({ enabled: z.boolean() });

export interface DataProviderDto {
  id: string;
  provider: ProviderId;
  keyHint: string | null;
  enabled: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

const columns = {
  id: schema.dataProvider.id,
  provider: schema.dataProvider.provider,
  keyHint: schema.dataProvider.keyHint,
  enabled: schema.dataProvider.enabled,
  lastUsedAt: schema.dataProvider.lastUsedAt,
  lastError: schema.dataProvider.lastError,
  createdAt: schema.dataProvider.createdAt,
  createdById: schema.dataProvider.createdById,
  createdByName: schema.user.name,
};

function baseQuery() {
  return db
    .select(columns)
    .from(schema.dataProvider)
    .leftJoin(schema.user, eq(schema.user.id, schema.dataProvider.createdById));
}

function toDto(row: Awaited<ReturnType<typeof baseQuery>>[number]): DataProviderDto {
  return {
    id: row.id,
    provider: row.provider,
    keyHint: row.keyHint,
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdById && row.createdByName ? { id: row.createdById, name: row.createdByName } : null,
  };
}

const order = (p: ProviderId) => PROVIDER_ORDER.indexOf(p);

export async function listDataProviders(actor: Actor): Promise<DataProviderDto[]> {
  const rows = await baseQuery()
    .where(eq(schema.dataProvider.organizationId, actor.organizationId))
    .orderBy(asc(schema.dataProvider.createdAt));
  return rows.map(toDto).sort((a, b) => order(a.provider) - order(b.provider));
}

async function dtoById(actor: Actor, id: string): Promise<DataProviderDto> {
  const [row] = await baseQuery()
    .where(and(eq(schema.dataProvider.organizationId, actor.organizationId), eq(schema.dataProvider.id, id)))
    .limit(1);
  if (!row) throw notFound("Data provider not found.");
  return toDto(row);
}

/** Save a provider's key, replacing the stored one if the workspace already has that provider. */
export async function saveDataProvider(
  actor: Actor,
  input: z.infer<typeof dataProviderCreateSchema>,
): Promise<{ dataProvider: DataProviderDto; created: boolean }> {
  const [existing] = await db
    .select({ id: schema.dataProvider.id })
    .from(schema.dataProvider)
    .where(
      and(
        eq(schema.dataProvider.organizationId, actor.organizationId),
        eq(schema.dataProvider.provider, input.provider),
      ),
    )
    .limit(1);
  const keyHint = secretHint(input.apiKey);
  const values = {
    apiKeyEnc: encryptSecret(input.apiKey),
    keyHint,
    enabled: input.enabled ?? true,
    lastError: null,
    lastUsedAt: null,
  };
  let id: string;
  if (existing) {
    await db.update(schema.dataProvider).set(values).where(eq(schema.dataProvider.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(schema.dataProvider)
      .values({ ...values, organizationId: actor.organizationId, provider: input.provider, createdById: actor.userId })
      .onConflictDoUpdate({
        target: [schema.dataProvider.organizationId, schema.dataProvider.provider],
        set: values,
      })
      .returning({ id: schema.dataProvider.id });
    id = row.id;
  }
  await audit(actor, existing ? "provider.key_replace" : "provider.connect", "data_provider", id, {
    provider: input.provider,
    keyHint,
    enabled: values.enabled,
  });
  return { dataProvider: await dtoById(actor, id), created: !existing };
}

export async function setDataProviderEnabled(actor: Actor, id: string, enabled: boolean): Promise<DataProviderDto> {
  const current = await dtoById(actor, id);
  if (current.enabled !== enabled) {
    await db
      .update(schema.dataProvider)
      .set({ enabled })
      .where(and(eq(schema.dataProvider.id, id), eq(schema.dataProvider.organizationId, actor.organizationId)));
    await audit(actor, enabled ? "provider.enable" : "provider.disable", "data_provider", id, {
      provider: current.provider,
    });
  }
  return dtoById(actor, id);
}

export async function deleteDataProvider(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const current = await dtoById(actor, id);
  await db
    .delete(schema.dataProvider)
    .where(and(eq(schema.dataProvider.id, id), eq(schema.dataProvider.organizationId, actor.organizationId)));
  await audit(actor, "provider.delete", "data_provider", id, { provider: current.provider });
  return { id, deleted: true };
}

const KEY_UNREADABLE = "The stored key can't be read (the installation's encryption key changed). Save the key again.";

/** One cheap call to the provider that spends no lookup credits. Stores the outcome as lastError. */
export async function testDataProvider(
  actor: Actor,
  id: string,
): Promise<{ ok: boolean; error: string | null; dataProvider: DataProviderDto }> {
  const [row] = await db
    .select({ provider: schema.dataProvider.provider, apiKeyEnc: schema.dataProvider.apiKeyEnc })
    .from(schema.dataProvider)
    .where(and(eq(schema.dataProvider.organizationId, actor.organizationId), eq(schema.dataProvider.id, id)))
    .limit(1);
  if (!row) throw notFound("Data provider not found.");
  const key = decryptSecret(row.apiKeyEnc);
  let error: string | null = null;
  if (!key) error = KEY_UNREADABLE;
  else {
    try {
      await providerClient(row.provider, key).testConnection();
    } catch (e) {
      error = e instanceof ProviderError ? e.message : "The connection test failed. Try again later.";
      if (!(e instanceof ProviderError)) log.error("provider test failed", { component: "providers", error: e });
    }
  }
  await db.update(schema.dataProvider).set({ lastError: error }).where(eq(schema.dataProvider.id, id));
  await audit(actor, "provider.test", "data_provider", id, { provider: row.provider, ok: error === null });
  return { ok: error === null, error, dataProvider: await dtoById(actor, id) };
}

/* -------------------------------------------------------------------------- */
/* Use during enrichment                                                      */
/* -------------------------------------------------------------------------- */

interface ActiveProvider {
  id: string;
  provider: ProviderId;
  key: string;
}

/** The workspace's enabled providers with readable keys, in the fixed order. Internal only. */
async function activeProviders(organizationId: string): Promise<ActiveProvider[]> {
  const rows = await db
    .select({ id: schema.dataProvider.id, provider: schema.dataProvider.provider, enc: schema.dataProvider.apiKeyEnc })
    .from(schema.dataProvider)
    .where(and(eq(schema.dataProvider.organizationId, organizationId), eq(schema.dataProvider.enabled, true)));
  const out: ActiveProvider[] = [];
  for (const row of rows) {
    const key = decryptSecret(row.enc);
    if (key) out.push({ id: row.id, provider: row.provider, key });
    else
      await db.update(schema.dataProvider).set({ lastError: KEY_UNREADABLE }).where(eq(schema.dataProvider.id, row.id));
  }
  return out.sort((a, b) => order(a.provider) - order(b.provider));
}

async function recordUse(id: string, error: unknown): Promise<void> {
  if (error === null) {
    await db
      .update(schema.dataProvider)
      .set({ lastUsedAt: new Date(), lastError: null })
      .where(eq(schema.dataProvider.id, id));
    return;
  }
  let message = "The last lookup failed. Try the connection test.";
  if (error instanceof ProviderError) message = error.message;
  else log.error("provider lookup failed", { component: "providers", error });
  await db.update(schema.dataProvider).set({ lastError: message }).where(eq(schema.dataProvider.id, id));
}

export interface ProviderPersonHit {
  provider: ProviderId;
  result: PersonResult;
}

export type PersonField = Exclude<keyof PersonResult, "emailStatus" | "emailConfidence">;

/**
 * Ask the workspace's enabled providers, in order, for the fields still missing. Hunter only finds
 * email addresses, so it is asked only while the email is missing. Stops once nothing is missing.
 * Returns each provider's answer (so callers can attribute every field) and the providers called.
 */
export async function lookupPersonWithProviders(
  organizationId: string,
  query: PersonQuery,
  missing: PersonField[],
): Promise<{ hits: ProviderPersonHit[]; called: ProviderId[] }> {
  const hits: ProviderPersonHit[] = [];
  const called: ProviderId[] = [];
  if (!missing.length) return { hits, called };
  const providers = await activeProviders(organizationId);
  const still = new Set<PersonField>(missing);
  for (const p of providers) {
    if (!still.size) break;
    const client = providerClient(p.provider, p.key);
    if (!client.personFields && !still.has("email")) continue;
    called.push(p.provider);
    try {
      const result = await client.matchPerson(query);
      await recordUse(p.id, null);
      if (!result) continue;
      hits.push({ provider: p.provider, result });
      for (const field of [...still]) if (result[field] !== null) still.delete(field);
    } catch (error) {
      await recordUse(p.id, error);
    }
  }
  return { hits, called };
}

export interface ProviderCompanyHit {
  provider: ProviderId;
  result: CompanyResult;
}

export async function lookupCompanyWithProviders(
  organizationId: string,
  domain: string,
  missing: Array<keyof CompanyResult>,
): Promise<{ hits: ProviderCompanyHit[]; called: ProviderId[] }> {
  const hits: ProviderCompanyHit[] = [];
  const called: ProviderId[] = [];
  if (!missing.length) return { hits, called };
  const providers = await activeProviders(organizationId);
  const still = new Set(missing);
  for (const p of providers) {
    if (!still.size) break;
    const client = providerClient(p.provider, p.key);
    if (!client.companyFields) continue;
    called.push(p.provider);
    try {
      const result = await client.enrichCompany({ domain });
      await recordUse(p.id, null);
      if (!result) continue;
      hits.push({ provider: p.provider, result });
      for (const field of [...still]) if (result[field] !== null) still.delete(field);
    } catch (error) {
      await recordUse(p.id, error);
    }
  }
  return { hits, called };
}
