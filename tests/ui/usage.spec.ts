import { expect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs } from "./admin-ui";

/** Usage and activity: own usage for everyone, the member breakdown only with audit:read. */

const shot = (name: string, project: string) => `.playwright-mcp/wp-e/usage-${project}-${name}.png`;

test.describe("usage screen", () => {
  test.describe.configure({ timeout: 90_000 });
  test("a manager sees workspace usage, members and data requests", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      const res = await page.goto("/dashboard/settings/usage");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Usage and activity" })).toBeVisible();
      await expect(page.getByText("How usage is counted")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Workspace,/ })).toBeVisible();
      await expect(page.getByText("By member", { exact: true })).toBeVisible();
      await expect(page.getByText(ACME.member).first()).toBeVisible();
      await expect(page.getByText("Data requests", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("manager", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a member sees only their own usage, in dark mode", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.member, { dark: true });
    try {
      const res = await page.goto("/dashboard/settings/usage");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: /^Your usage,/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Workspace,/ })).toHaveCount(0);
      await expect(page.getByText("By member", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Email verifications").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("member-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
