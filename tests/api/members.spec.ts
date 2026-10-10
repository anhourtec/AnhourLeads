import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import {
  acceptInvite,
  acmeKeyClient,
  addFreshMember,
  EVIL_ORIGIN,
  findMail,
  freshWorkspace,
  globexApi,
  invite,
  mailText,
  signUpFresh,
  uniq,
  userIdOf,
} from "./admin-helpers";

const freshEmail = (prefix = "inv") => `${uniq(prefix)}@example.com`.toLowerCase();

test.describe("members API", () => {
  test("search and api_profile: every role; 401 signed out", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const search = await api.get("/api/v1/users/search?per_page=100");
      expect(search.status(), role).toBe(expected(role, "member:read"));
      if (search.ok()) {
        const users = (await search.json()).users as { email: string; role: string }[];
        expect(users.find((u) => u.email === ACME.owner)?.role).toBe("owner");
        expect(users.some((u) => u.email === GLOBEX_OWNER)).toBe(false);
      }
      const profile = await api.get("/api/v1/users/api_profile");
      expect(profile.status(), role).toBe(200);
      const body = await profile.json();
      expect(body).toMatchObject({ authenticatedAs: "user", role, user: { email: ACME[role] } });
      expect(body.workspace.slug).toBe("acme");
      expect(body.permissions).toContain("task:read");
      expect(body.permissions.includes("member:invite")).toBe(role === "owner" || role === "admin");
    }
    const anon = await anonymous();
    expect((await anon.get("/api/v1/users/search")).status()).toBe(401);
    expect((await anon.get("/api/v1/users/api_profile")).status()).toBe(401);
    const filtered = await (await (await apiAsRole("viewer")).get("/api/v1/users/search?role=manager")).json();
    expect(filtered.users.every((u: { role: string }) => u.role === "manager")).toBe(true);
  });

  test("api_profile with an API key reports the key and its role", async () => {
    const key = await acmeKeyClient("member");
    const body = await (await key.get("/api/v1/users/api_profile")).json();
    expect(body).toMatchObject({ authenticatedAs: "apiKey", role: "member", user: null });
    expect(body.apiKey.prefix).toMatch(/^al_[0-9a-f]{8}$/);
    expect(body.permissions).not.toContain("member:invite");
  });

  test("invite, list and cancel invitations: every role per matrix", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "viewer" } });
      expect(res.status(), `${role} invite`).toBe(expected(role, "member:invite", 201));

      const list = await api.get("/api/v1/users/invitations");
      expect(list.status(), `${role} list`).toBe(expected(role, "member:invite"));

      const target = await invite(owner, freshEmail(), "viewer");
      const cancel = await api.delete(`/api/v1/users/invitations/${target}`);
      expect(cancel.status(), `${role} cancel`).toBe(expected(role, "member:invite"));
    }
    expect((await (await anonymous()).post("/api/v1/users/invite", { data: {} })).status()).toBe(401);
  });

  test("invitation email arrives and accepting adds the member with the invited role", async () => {
    const admin = await apiAsRole("admin");
    const fresh = await signUpFresh("accept");
    const invitationId = await invite(admin, fresh.email, "manager");

    const pending = await (await admin.get("/api/v1/users/invitations")).json();
    expect(pending.invitations.find((i: { id: string }) => i.id === invitationId)).toMatchObject({
      email: fresh.email,
      role: "manager",
      status: "pending",
    });

    const mail = await findMail(fresh.email);
    expect(mail, "invitation email in Mailpit").not.toBeNull();
    expect(mail?.Subject).toContain("invited you to");
    const text = await mailText(mail?.ID ?? "");
    expect(text).toContain(`${BASE_URL}/auth/accept-invite/${invitationId}`);

    await acceptInvite(fresh.api, invitationId);
    const profile = await (await fresh.api.get("/api/v1/users/api_profile")).json();
    expect(profile).toMatchObject({ role: "manager", workspace: { slug: "acme" } });
    const members = await (await admin.get(`/api/v1/users/search?q=${encodeURIComponent(fresh.email)}`)).json();
    expect(members.users).toHaveLength(1);
    expect(members.users[0].role).toBe("manager");
    const after = await (await admin.get("/api/v1/users/invitations")).json();
    expect(after.invitations.some((i: { id: string }) => i.id === invitationId)).toBe(false);
  });

  test("invite validation and duplicates", async () => {
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/users/invite", { data: { email: "nope", role: "member" } })).status()).toBe(422);
    expect(
      (await owner.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "superuser" } })).status(),
    ).toBe(422);
    const email = freshEmail();
    await invite(owner, email, "member");
    expect((await owner.post("/api/v1/users/invite", { data: { email, role: "member" } })).status()).toBe(409);
    expect(
      (
        await owner.post("/api/v1/users/invite", { data: { email: ACME.viewer.toUpperCase(), role: "member" } })
      ).status(),
    ).toBe(409);
    expect((await owner.delete(`/api/v1/users/invitations/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("change role and remove: every role per matrix", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const target = await addFreshMember(owner, "viewer", `rc-${role}`);
      const patch = await api.patch(`/api/v1/users/${target.userId}`, { data: { role: "member" } });
      expect(patch.status(), `${role} patch`).toBe(expected(role, "member:update"));
      if (patch.ok()) expect((await patch.json()).user.role).toBe("member");
      const del = await api.delete(`/api/v1/users/${target.userId}`);
      expect(del.status(), `${role} delete`).toBe(expected(role, "member:remove"));
      if (del.ok()) {
        // A removed member loses access straight away.
        expect((await target.api.get("/api/v1/users/api_profile")).status()).toBe(403);
      }
    }
    expect((await owner.patch(`/api/v1/users/${crypto.randomUUID()}`, { data: { role: "member" } })).status()).toBe(
      404,
    );
    const anyone = await addFreshMember(owner, "viewer", "rc-422");
    expect((await owner.patch(`/api/v1/users/${anyone.userId}`, { data: { role: "god" } })).status()).toBe(422);
    expect((await owner.patch(`/api/v1/users/${anyone.userId}`, { data: {} })).status()).toBe(422);
    await owner.delete(`/api/v1/users/${anyone.userId}`);
  });

  test("guard rails in a fresh workspace", async () => {
    const ws = await freshWorkspace();
    const admin = await addFreshMember(ws.api, "admin", "gr-admin");
    const admin2 = await addFreshMember(ws.api, "admin", "gr-admin2");
    const manager = await addFreshMember(ws.api, "manager", "gr-manager");
    const viewer = await addFreshMember(ws.api, "viewer", "gr-viewer");

    // Nobody grants a role above their own; only owners make owners.
    expect(
      (await admin.api.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "owner" } })).status(),
    ).toBe(403);
    expect(
      (await admin.api.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "admin" } })).status(),
    ).toBe(201);
    expect((await admin.api.patch(`/api/v1/users/${manager.userId}`, { data: { role: "owner" } })).status()).toBe(403);
    expect((await admin.api.patch(`/api/v1/users/${admin.userId}`, { data: { role: "owner" } })).status()).toBe(403);
    // Nobody changes or removes someone ranked above them.
    expect((await admin.api.patch(`/api/v1/users/${ws.userId}`, { data: { role: "admin" } })).status()).toBe(403);
    expect((await admin.api.delete(`/api/v1/users/${ws.userId}`)).status()).toBe(403);
    // Equal rank is fine.
    expect((await admin.api.patch(`/api/v1/users/${admin2.userId}`, { data: { role: "manager" } })).status()).toBe(200);
    // Managers and viewers can't invite or change roles.
    expect(
      (await manager.api.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "viewer" } })).status(),
    ).toBe(403);
    expect((await manager.api.patch(`/api/v1/users/${viewer.userId}`, { data: { role: "member" } })).status()).toBe(
      403,
    );
    expect((await viewer.api.patch(`/api/v1/users/${viewer.userId}`, { data: { role: "admin" } })).status()).toBe(403);
    expect((await viewer.api.delete(`/api/v1/users/${manager.userId}`)).status()).toBe(403);

    // The last owner can't be demoted or removed, not even by themselves.
    expect((await ws.api.patch(`/api/v1/users/${ws.userId}`, { data: { role: "admin" } })).status()).toBe(409);
    expect((await ws.api.delete(`/api/v1/users/${ws.userId}`)).status()).toBe(409);

    // With a second owner, the first can step down; an admin still can't touch owners.
    expect((await ws.api.patch(`/api/v1/users/${admin.userId}`, { data: { role: "owner" } })).status()).toBe(200);
    expect((await admin2.api.delete(`/api/v1/users/${admin.userId}`)).status()).toBe(403);
    expect((await ws.api.patch(`/api/v1/users/${ws.userId}`, { data: { role: "admin" } })).status()).toBe(200);
    // Now the promoted owner is the last one.
    expect((await admin.api.delete(`/api/v1/users/${admin.userId}`)).status()).toBe(409);
    // The demoted founder (now admin) can't demote the remaining owner.
    expect((await ws.api.patch(`/api/v1/users/${admin.userId}`, { data: { role: "member" } })).status()).toBe(403);

    // Admins can't cancel an invitation for a role above their own.
    const ownerInvite = await invite(admin.api, freshEmail(), "owner");
    expect((await ws.api.delete(`/api/v1/users/invitations/${ownerInvite}`)).status()).toBe(403);
  });

  test("API keys can't manage members", async () => {
    const key = await acmeKeyClient("owner");
    expect((await key.get("/api/v1/users/search")).status()).toBe(200);
    expect((await key.post("/api/v1/users/invite", { data: { email: freshEmail(), role: "viewer" } })).status()).toBe(
      403,
    );
    const viewerId = await userIdOf(ACME.viewer);
    expect((await key.patch(`/api/v1/users/${viewerId}`, { data: { role: "member" } })).status()).toBe(403);
    expect((await key.delete(`/api/v1/users/${viewerId}`)).status()).toBe(403);
  });

  test("Globex isolation: other workspaces' people and invitations are 404", async () => {
    const owner = await apiAsRole("owner");
    const globexOwnerId = await userIdOf(GLOBEX_OWNER);
    expect((await owner.patch(`/api/v1/users/${globexOwnerId}`, { data: { role: "viewer" } })).status()).toBe(404);
    expect((await owner.delete(`/api/v1/users/${globexOwnerId}`)).status()).toBe(404);

    const globex = await globexApi();
    const acmeViewer = await userIdOf(ACME.viewer);
    expect((await globex.patch(`/api/v1/users/${acmeViewer}`, { data: { role: "member" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/users/${acmeViewer}`)).status()).toBe(404);
    const invitationId = await invite(owner, freshEmail(), "viewer");
    expect((await globex.delete(`/api/v1/users/invitations/${invitationId}`)).status()).toBe(404);
    const list = await (await globex.get("/api/v1/users/invitations")).json();
    expect(list.invitations.some((i: { id: string }) => i.id === invitationId)).toBe(false);
    const people = await (await globex.get("/api/v1/users/search?per_page=100")).json();
    expect(people.users.map((u: { email: string }) => u.email)).toEqual([GLOBEX_OWNER]);
  });

  test("cross-site cookie writes are refused", async () => {
    const owner = await apiAsRole("owner");
    expect(
      (
        await owner.post("/api/v1/users/invite", {
          headers: EVIL_ORIGIN,
          data: { email: freshEmail(), role: "viewer" },
        })
      ).status(),
    ).toBe(403);
    const viewerId = await userIdOf(ACME.viewer);
    expect(
      (await owner.patch(`/api/v1/users/${viewerId}`, { headers: EVIL_ORIGIN, data: { role: "member" } })).status(),
    ).toBe(403);
    expect((await owner.delete(`/api/v1/users/${viewerId}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
  });

  test("member changes are audited", async () => {
    const owner = await apiAsRole("owner");
    const target = await addFreshMember(owner, "viewer", "audit");
    await owner.patch(`/api/v1/users/${target.userId}`, { data: { role: "member" } });
    await owner.delete(`/api/v1/users/${target.userId}`);
    const log = await (await owner.get(`/api/v1/audit_logs?action=member.&entityId=${target.userId}`)).json();
    expect(log.audit_logs.map((l: { action: string }) => l.action)).toEqual(["member.remove", "member.role_change"]);
  });
});

test.describe("workspace API", () => {
  test("get: every role; 401 signed out", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/workspace");
      expect(res.status(), role).toBe(200);
      expect((await res.json()).workspace).toMatchObject({ slug: "acme", role });
    }
    expect((await (await anonymous()).get("/api/v1/workspace")).status()).toBe(401);
  });

  test("rename and delete: per matrix in Acme without changing it", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const patch = await api.patch("/api/v1/workspace", { data: { name: "Acme Outbound" } });
      expect(patch.status(), role).toBe(expected(role, "workspace:update"));
      // A wrong confirmation never deletes: owners get 422, everyone else 403.
      const del = await api.delete("/api/v1/workspace", { data: { confirm: "wrong name" } });
      expect(del.status(), role).toBe(expected(role, "workspace:delete", 422));
    }
    const owner = await apiAsRole("owner");
    expect((await owner.patch("/api/v1/workspace", { data: { name: "" } })).status()).toBe(422);
    expect((await owner.patch("/api/v1/workspace", { headers: EVIL_ORIGIN, data: { name: "X Y" } })).status()).toBe(
      403,
    );
    const key = await acmeKeyClient("owner");
    expect((await key.delete("/api/v1/workspace", { data: { confirm: "Acme Outbound" } })).status()).toBe(403);
  });

  test("rename and delete a fresh workspace", async () => {
    const ws = await freshWorkspace();
    const renamed = await ws.api.patch("/api/v1/workspace", { data: { name: `${ws.name} renamed` } });
    expect((await renamed.json()).workspace.name).toBe(`${ws.name} renamed`);
    expect((await ws.api.delete("/api/v1/workspace", { data: { confirm: ws.name } })).status()).toBe(422);
    const gone = await ws.api.delete("/api/v1/workspace", { data: { confirm: `${ws.name} renamed` } });
    expect(gone.status()).toBe(200);
    expect((await ws.api.get("/api/v1/workspace")).status()).toBe(403);
  });
});
