import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, shot } from "./admin-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("overview screen", () => {
  for (const role of ROLES) {
    test(`renders for ${role}`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "viewer" });
      try {
        const res = await page.goto("/dashboard/overview");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: /Welcome back, Acme/ })).toBeVisible();
        const kpis = page.getByRole("region", { name: "Key numbers" });
        await expect(kpis.getByText("People", { exact: true })).toBeVisible();
        await expect(kpis.getByText("Verified emails")).toBeVisible();
        await expect(kpis.getByText("Open pipeline")).toBeVisible();
        await expect(page.getByText("Pipeline by stage")).toBeVisible();
        await expect(page.getByText("My tasks due")).toBeVisible();
        const activity = page.getByText("Recent activity");
        if (can(role, "audit:read")) await expect(activity).toBeVisible();
        else await expect(activity).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        if (role === "owner" || role === "viewer") {
          await page.screenshot({ path: shot(`overview-${role}`, info.project.name), fullPage: true });
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
