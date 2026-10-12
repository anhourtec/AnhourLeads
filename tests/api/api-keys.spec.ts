import { expect, test } from "@playwright/test";

import { can, outranksOrEquals, ROLES } from "../../src/lib/rbac/permissions";
import { expected } from "../support/matrix";
import { anonymous, apiAsRole, apiWithKey, TENANT_URL } from "../support/session";
import { acmeKey, createKey, db, EVIL_ORIGIN, globexApi, globexKey, uniq } from "./admin-helpers";

test.describe("API keys API", () => {
  test("list: every role per matrix; never returns the secret or hash", async () => {
    const owner = await apiAsRole("owner");
    const { secret, id } = await createKey(owner, "viewer");
    const { rows } = await db().query<{ hash: string }>("select hash from api_key where id = $1", [id]);
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/api_keys?per_page=100");
      expect(res.status(), role).toBe(expected(role, "apikey:read"));
      if (res.ok()) {
        const text = await res.text();
        expect(text).not.toContain(secret);
        expect(text).not.toContain(rows[0].hash);
        const key = JSON.parse(text).api_keys.find((k: { id: string }) => k.id === id);
        expect(Object.keys(key).sort()).toEqual(
          ["createdAt", "createdBy", "id", "lastUsedAt", "name", "prefix", "revokedAt", "role"].sort(),
        );
      }
    }
    expect((await (await anonymous()).get("/api/v1/api_keys")).status()).toBe(401);
  });

  test("create: every role per matrix; secret format; stored hashed; shown once", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/api_keys", { data: { name: uniq(role), role: "viewer" } });
      expect(res.status(), role).toBe(expected(role, "apikey:create", 201));
      if (res.ok()) {
        const body = await res.json();
        expect(body.secret).toMatch(/^al_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
        expect(body.secret.startsWith(`${body.api_key.prefix}_`)).toBe(true);
        expect(body.api_key.createdBy.email).toBe(`${role}@acme.test`);
        const { rows } = await db().query<{ hash: string }>("select hash from api_key where id = $1", [
          body.api_key.id,
        ]);
        expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
        expect(rows[0].hash).not.toContain(body.secret);
        const list = await (await api.get("/api/v1/api_keys?per_page=100")).json();
        expect(JSON.stringify(list)).not.toContain(body.secret);
      }
    }
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/api_keys", { data: { name: "", role: "viewer" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/api_keys", { data: { name: "x", role: "root" } })).status()).toBe(422);
  });

  test("a key's role can't exceed its creator's", async () => {
    const admin = await apiAsRole("admin");
    expect((await admin.post("/api/v1/api_keys", { data: { name: "x", role: "owner" } })).status()).toBe(403);
    expect((await admin.post("/api/v1/api_keys", { data: { name: uniq("adm"), role: "admin" } })).status()).toBe(201);
  });

  test("keys authenticate with their own role, by header or bearer token", async () => {
    for (const role of ROLES) {
      const { secret } = await acmeKey(role);
      const api = await apiWithKey(secret);
      const profile = await (await api.get("/api/v1/users/api_profile")).json();
      expect(profile).toMatchObject({ authenticatedAs: "apiKey", role });
      // Write permission follows the key's role, and keys skip the CSRF check (no cookie).
      const task = await api.post("/api/v1/tasks", { data: { title: uniq(`key ${role}`) } });
      expect(task.status(), role).toBe(can(role, "task:create") ? 201 : 403);
      const keys = await api.get("/api/v1/api_keys");
      expect(keys.status(), role).toBe(expected(role, "apikey:read"));
    }
    const bearer = await anonymous();
    const res = await bearer.get("/api/v1/users/api_profile", {
      headers: { authorization: `Bearer ${(await acmeKey("viewer")).secret}` },
    });
    expect((await res.json()).role).toBe("viewer");
    const bogus = await apiWithKey("al_00000000_notarealkeynotarealkeynotarealkeynotareal");
    expect((await bogus.get("/api/v1/users/api_profile")).status()).toBe(401);
  });

  test("API keys can't create keys; keys may revoke only up to their role", async () => {
    const ownerKey = await apiWithKey((await acmeKey("owner")).secret);
    expect((await ownerKey.post("/api/v1/api_keys", { data: { name: "x", role: "viewer" } })).status()).toBe(403);
    const owner = await apiAsRole("owner");
    const victim = await createKey(owner, "viewer");
    expect((await ownerKey.delete(`/api/v1/api_keys/${victim.id}`)).status()).toBe(200);
    const adminKey = await apiWithKey((await acmeKey("admin")).secret);
    const ownerRole = await createKey(owner, "owner");
    expect((await adminKey.delete(`/api/v1/api_keys/${ownerRole.id}`)).status()).toBe(403);
    await owner.delete(`/api/v1/api_keys/${ownerRole.id}`);
  });

  test("revoke: every role per matrix; revoked keys stop working and stay listed", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const key = await createKey(owner, "viewer");
      const api = await apiAsRole(role);
      const res = await api.delete(`/api/v1/api_keys/${key.id}`);
      const allowed = can(role, "apikey:revoke") && outranksOrEquals(role, "viewer");
      expect(res.status(), role).toBe(allowed ? 200 : 403);
    }
    const key = await createKey(owner, "member");
    const client = await apiWithKey(key.secret);
    expect((await client.get("/api/v1/users/api_profile")).status()).toBe(200);
    const revoked = await owner.delete(`/api/v1/api_keys/${key.id}`);
    expect((await revoked.json()).api_key.revokedAt).toBeTruthy();
    expect((await client.get("/api/v1/users/api_profile")).status()).toBe(401);
    expect((await owner.delete(`/api/v1/api_keys/${key.id}`)).status()).toBe(200);
    const list = await (await owner.get("/api/v1/api_keys?per_page=100")).json();
    expect(list.api_keys.find((k: { id: string }) => k.id === key.id).revokedAt).toBeTruthy();
    expect((await owner.delete(`/api/v1/api_keys/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("records last use", async () => {
    const owner = await apiAsRole("owner");
    const key = await createKey(owner, "viewer");
    await (await apiWithKey(key.secret)).get("/api/v1/users/api_profile");
    await expect
      .poll(async () => {
        const list = await (await owner.get("/api/v1/api_keys?per_page=100")).json();
        return list.api_keys.find((k: { id: string }) => k.id === key.id).lastUsedAt;
      })
      .toBeTruthy();
  });

  test("Globex isolation: keys and their ids stay in their workspace", async () => {
    const owner = await apiAsRole("owner");
    const acme = await createKey(owner, "viewer");
    const globex = await globexApi();
    expect((await globex.delete(`/api/v1/api_keys/${acme.id}`)).status()).toBe(404);
    const list = await (await globex.get("/api/v1/api_keys?per_page=100")).json();
    expect(list.api_keys.some((k: { id: string }) => k.id === acme.id)).toBe(false);
    const globexSecret = (await globexKey()).secret;
    const globexClient = await apiWithKey(globexSecret);
    expect((await globexClient.delete(`/api/v1/api_keys/${acme.id}`)).status()).toBe(404);
    // A Globex key can't be used on Acme's own hostname.
    const onAcmeHost = await apiWithKey(globexSecret, TENANT_URL);
    expect((await onAcmeHost.get("/api/v1/users/api_profile")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused; key events are audited without secrets", async () => {
    const owner = await apiAsRole("owner");
    expect(
      (await owner.post("/api/v1/api_keys", { headers: EVIL_ORIGIN, data: { name: "x", role: "viewer" } })).status(),
    ).toBe(403);
    const key = await createKey(owner, "viewer");
    expect((await owner.delete(`/api/v1/api_keys/${key.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    await owner.delete(`/api/v1/api_keys/${key.id}`);
    const log = await (await owner.get(`/api/v1/audit_logs?entityId=${key.id}`)).json();
    expect(log.audit_logs.map((l: { action: string }) => l.action)).toEqual(["apikey.revoke", "apikey.create"]);
    const { rows } = await db().query<{ hash: string }>("select hash from api_key where id = $1", [key.id]);
    const text = JSON.stringify(log);
    expect(text).not.toContain(key.secret);
    expect(text).not.toContain(rows[0].hash);
  });
});
