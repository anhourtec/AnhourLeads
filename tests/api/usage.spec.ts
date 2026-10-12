import { expect, test } from "@playwright/test";

import { can } from "../../src/lib/rbac/permissions";
import { ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { userIdOf } from "./admin-helpers";

/** Usage & activity: own usage for everyone, workspace and per-member breakdown with audit:read. */

interface Counts {
  peopleLookups: number;
  companyLookups: number;
  emailVerifications: number;
  cachedLookups: number;
  crawlPages: number;
  emailsSent: number;
  aiMessages: number;
}

interface Usage {
  me: { thisMonth: Counts; lastMonth: Counts };
  workspace: { thisMonth: Counts; lastMonth: Counts } | null;
  users: Array<{ userId: string; email: string; thisMonth: Counts }> | null;
  dataRequests: unknown[] | null;
}

async function usageOf(role: (typeof ROLES)[number]): Promise<Usage> {
  const res = await (await apiAsRole(role)).get("/api/v1/usage");
  expect(res.status()).toBe(200);
  return (await res.json()).usage;
}

test.describe("usage", () => {
  for (const role of ROLES) {
    test(`${role} sees own usage; the breakdown only with audit:read`, async () => {
      const usage = await usageOf(role);
      expect(typeof usage.me.thisMonth.emailVerifications).toBe("number");
      if (can(role, "audit:read")) {
        expect(usage.workspace).not.toBeNull();
        expect(usage.users?.some((u) => u.email === ACME.member)).toBe(true);
        expect(Array.isArray(usage.dataRequests)).toBe(true);
      } else {
        expect(usage.workspace).toBeNull();
        expect(usage.users).toBeNull();
        expect(usage.dataRequests).toBeNull();
      }
    });
  }

  test("an email verification counts for the member and the workspace; cached repeats are counted as cached", async () => {
    const before = await usageOf("member");
    const managerBefore = await usageOf("manager");
    const member = await apiAsRole("member");
    const email = `usage-${Date.now()}@example.invalid`;
    expect((await member.post("/api/v1/email_verifications", { data: { email } })).status()).toBe(200);
    expect((await member.post("/api/v1/email_verifications", { data: { email } })).status()).toBe(200);

    const after = await usageOf("member");
    // Other specs verify addresses as the member at the same time, so counts only grow by at least 2.
    expect(after.me.thisMonth.emailVerifications).toBeGreaterThanOrEqual(before.me.thisMonth.emailVerifications + 2);
    expect(after.me.thisMonth.cachedLookups).toBeGreaterThanOrEqual(before.me.thisMonth.cachedLookups + 1);

    const managerAfter = await usageOf("manager");
    expect(managerAfter.workspace?.thisMonth.emailVerifications).toBeGreaterThanOrEqual(
      (managerBefore.workspace?.thisMonth.emailVerifications ?? 0) + 2,
    );
    expect(managerAfter.me.thisMonth.emailVerifications).toBe(managerBefore.me.thisMonth.emailVerifications);
    const memberId = await userIdOf(ACME.member);
    const memberRow = managerAfter.users?.find((u) => u.userId === memberId);
    expect(memberRow?.thisMonth.emailVerifications).toBeGreaterThanOrEqual(after.me.thisMonth.emailVerifications);
  });

  test("Globex never sees Acme members or usage", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    const usage = (await (await globex.get("/api/v1/usage")).json()).usage as Usage;
    expect(usage.users?.some((u) => u.email.endsWith("@acme.test"))).toBe(false);
  });

  test("unauthenticated → 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/usage")).status()).toBe(401);
  });
});
