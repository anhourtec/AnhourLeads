import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, openAs, shot, uid } from "./admin-ui";
import { ownErrors } from "./shell-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

const PATH = "/dashboard/settings/data-providers";

/** Each viewport works on a different provider, so parallel projects never touch the same row. */
const PROVIDER_FOR: Record<string, { id: string; name: string }> = {
  "ui-desktop": { id: "hunter", name: "Hunter" },
  "ui-tablet": { id: "apollo", name: "Apollo" },
  "ui-mobile": { id: "people_data_labs", name: "People Data Labs" },
};

test.describe("data providers settings", () => {
  for (const role of ROLES) {
    test(`nav item and page gating for ${role}`, async ({ browser }) => {
      const allowed = can(role, "provider:manage");
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "admin" });
      try {
        await page.goto("/dashboard/settings");
        await expect(page.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeVisible();
        await expect(page.getByRole("main").getByRole("link", { name: "Data providers" })).toHaveCount(allowed ? 1 : 0);
        const before = errors.length;
        const res = await page.goto(PATH);
        expect(res?.status()).toBe(allowed ? 200 : 404);
        if (allowed) {
          await expect(page.getByRole("heading", { level: 1, name: "Data providers" })).toBeVisible();
          await expect(page.getByText("Results stay in this workspace")).toBeVisible();
          for (const name of ["People Data Labs", "Apollo", "Hunter"]) {
            await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
          }
          await expectNoHorizontalOverflow(page);
        } else {
          errors.splice(before);
        }
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  for (const dark of [false, true]) {
    test(`owner saves a key: the hint is shown, never the key (${dark ? "dark" : "light"})`, async ({
      browser,
    }, info) => {
      const provider = PROVIDER_FOR[info.project.name] ?? { id: "hunter", name: "Hunter" };
      const { context, page, errors } = await openAs(browser, ACME.owner, { dark });
      const key = `uitest${uid()}KEY${dark ? "d" : "l"}`;
      try {
        // Start from a clean slate for this provider.
        const api = await apiAs(ACME.owner);
        const existing = await api.get("/api/v1/data_providers");
        for (const p of (await existing.json()).data_providers as Array<{ id: string; provider: string }>) {
          if (p.provider === provider.id) await api.delete(`/api/v1/data_providers/${p.id}`);
        }
        await page.goto(PATH);
        const card = page.getByTestId(`provider-${provider.id}`);
        await expect(card.getByText("Not connected")).toBeVisible();
        await card.getByLabel("API key", { exact: true }).fill(key);
        await card.getByRole("button", { name: "Save key" }).click();
        await expect(card.getByTestId("key-hint")).toHaveText(`ends in ${key.slice(-4)}`);
        await expect(card.getByLabel("API key", { exact: true })).toHaveCount(0);
        expect(await page.content()).not.toContain(key);

        // Turn it off, then remove it.
        const toggle = card.getByRole("switch", { name: "Use during enrichment" });
        await expect(toggle).toBeChecked();
        await toggle.click();
        await expect(card.getByText("Off", { exact: true })).toBeVisible();
        await expect(toggle).not.toBeChecked();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: shot(`data-providers-${dark ? "dark" : "light"}`, info.project.name),
          fullPage: true,
        });

        await page.reload();
        expect(await page.content()).not.toContain(key);
        await card.getByRole("button", { name: "Remove" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Remove provider" }).click();
        await expect(card.getByText("Not connected")).toBeVisible();
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
