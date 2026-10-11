import { expect, test } from "@playwright/test";

import { pg } from "../api/_engage";
import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, openAs } from "./admin-ui";

/**
 * Email setup and health (settings → deliverability) at desktop, tablet and mobile widths.
 * Domains added here end in `.invalid`, so their DNS checks never depend on the network.
 */
const shot = (name: string, project: string) => `.playwright-mcp/wp-e/deliverability-${project}-${name}.png`;
const TABS = ["Overview", "Domains", "Mailboxes", "Sending protection"];

test.afterAll(async () => {
  await pg().query("delete from sending_domain where domain like 'wpe-ui-%'");
});

test.describe("email setup and health", () => {
  test("an admin sees every tab, checks a domain and toggles a protection", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const api = await apiAs(ACME.admin);
    const original = (await (await api.get("/api/v1/sending_policy")).json()).sending_policy as {
      bounceGuard: boolean;
    };
    const { context, page, errors } = await openAs(browser, ACME.admin);
    try {
      const res = await page.goto("/dashboard/settings/deliverability");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Email setup and health" })).toBeVisible();
      for (const name of TABS) await expect(page.getByRole("tab", { name })).toBeVisible();
      await expect(page.getByText("Deliverability and activity", { exact: true })).toBeVisible();
      await expect(page.getByText("Top performing sequences", { exact: true })).toBeVisible();
      await expect(page.getByText("Recommendations", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Invite teammate" })).toBeVisible();
      await page.getByRole("button", { name: "Show as table" }).click();
      await expect(page.getByRole("columnheader", { name: "Delivered" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("overview", info.project.name), fullPage: true });

      // Domains: add one without DNS records and read the result pills.
      await page.getByRole("tab", { name: "Domains" }).click();
      await expect(page).toHaveURL(/tab=domains/);
      const domain = `wpe-ui-${info.project.name}-${Date.now().toString(36)}.invalid`;
      await page.getByLabel("Add a sending domain").fill(domain);
      await page.getByRole("button", { name: "Add and check" }).click();
      const card = page.getByTestId(`sending-domain-${domain}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      for (const check of ["SPF", "DKIM", "DMARC", "MX"]) {
        await expect(card.getByText(`${check}: Missing`)).toBeVisible();
      }
      await expect(card.getByRole("button", { name: "Copy example SPF record" })).toBeVisible();
      await card.getByRole("button", { name: "Check now" }).click();
      await expect(page.getByText(`Checked ${domain}`)).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("domains", info.project.name), fullPage: true });

      await page.getByRole("tab", { name: "Mailboxes" }).click();
      await expect(page.getByRole("link", { name: "Manage mailboxes" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Sending protection: switches per group; one-click unsubscribe is locked on.
      await page.getByRole("tab", { name: "Sending protection" }).click();
      await expect(page).toHaveURL(/tab=protection/);
      for (const title of ["Domain protection", "Who gets emailed", "Sending safeguards"]) {
        await expect(page.getByText(title, { exact: true })).toBeVisible();
      }
      await expect(page.getByRole("switch", { name: "One-click unsubscribe" })).toBeDisabled();
      await expect(page.getByRole("switch", { name: "One-click unsubscribe" })).toBeChecked();
      const guard = page.getByRole("switch", { name: "Bounce guard" });
      await expect(guard).toBeEnabled();
      await guard.click();
      await expect(page.getByText(`Bounce guard turned ${original.bounceGuard ? "off" : "on"}`)).toBeVisible();
      await guard.click();
      await expect(page.getByText(`Bounce guard turned ${original.bounceGuard ? "on" : "off"}`)).toBeVisible();
      await page.getByRole("button", { name: "View bounce logs" }).click();
      await expect(page.getByRole("dialog").getByText("Bounce logs", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("protection", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await api.patch("/api/v1/sending_policy", { data: { bounceGuard: original.bounceGuard } });
      await context.close();
    }
  });

  test("a manager sees the policy read-only, in dark mode", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.manager, { dark: true });
    try {
      const res = await page.goto("/dashboard/settings/deliverability?tab=protection");
      expect(res?.status()).toBe(200);
      await expect(page.getByText("An administrator can change them.")).toBeVisible();
      for (const name of ["Bounce guard", "Restrict catch-all domains", "Gradual sending increase"]) {
        await expect(page.getByRole("switch", { name })).toBeDisabled();
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("protection-manager-dark", info.project.name), fullPage: true });
      await page.getByRole("tab", { name: "Domains" }).click();
      await expect(page.getByLabel("Add a sending domain")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Invite teammate" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const role of ["member", "viewer"] as const) {
    test(`a ${role} can't open the screen (404)`, async ({ browser }) => {
      const { context, page } = await openAs(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/settings/deliverability");
        expect(res?.status()).toBe(404);
      } finally {
        await context.close();
      }
    });
  }
});
