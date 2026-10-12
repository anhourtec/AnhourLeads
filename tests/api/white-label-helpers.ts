/**
 * Helpers for the branding, domains and platform specs: API keys inserted straight into the
 * database (so these specs don't depend on the API key screens), and lookups by email.
 */
import "dotenv/config";

import pg from "pg";

import { createHash, randomBytes, randomUUID } from "node:crypto";

let pool: pg.Pool | null = null;
function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/** The workspace a seeded user belongs to (first membership). */
export async function workspaceOf(email: string): Promise<{ organizationId: string; userId: string }> {
  const { rows } = await db().query<{ organization_id: string; user_id: string }>(
    `select m.organization_id, m.user_id from member m join "user" u on u.id = m.user_id
      where u.email = $1 order by m.created_at limit 1`,
    [email],
  );
  if (!rows[0]) throw new Error(`no workspace for ${email}`);
  return { organizationId: rows[0].organization_id, userId: rows[0].user_id };
}

export async function workspaceIdBySlug(slug: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>("select id from organization where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`no workspace ${slug}`);
  return rows[0].id;
}

/** Create an API key for a seeded user's workspace. Returns the secret and a cleanup function. */
export async function createApiKey(
  email: string,
  role: string,
): Promise<{ secret: string; remove: () => Promise<void> }> {
  const { organizationId, userId } = await workspaceOf(email);
  const secret = `al_${randomBytes(24).toString("base64url")}`;
  const id = randomUUID();
  await db().query(
    `insert into api_key (id, organization_id, created_by_id, name, prefix, hash, role)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      organizationId,
      userId,
      "white-label spec",
      secret.slice(0, 7),
      createHash("sha256").update(secret).digest("hex"),
      role,
    ],
  );
  return {
    secret,
    remove: async () => {
      await db().query("delete from api_key where id = $1", [id]);
    },
  };
}

/** Delete every hostname a spec created (by pattern), so reruns start clean. */
export async function deleteHostnames(like: string): Promise<void> {
  await db().query("delete from workspace_domain where hostname like $1", [like]);
}

/** Latest audit entries with `action` in a workspace (by slug), newest first. */
export async function latestAudit(
  slug: string,
  action: string,
  limit = 5,
): Promise<{ entity_id: string | null; metadata: Record<string, unknown> | null; actor_user_id: string | null }[]> {
  const { rows } = await db().query(
    `select a.entity_id, a.metadata, a.actor_user_id from audit_log a join organization o on o.id = a.organization_id
      where o.slug = $1 and a.action = $2 order by a.created_at desc limit $3`,
    [slug, action, limit],
  );
  return rows;
}
