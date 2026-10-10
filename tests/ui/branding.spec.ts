import { expect, test } from "@playwright/test";

import { ACME, anonymous, BASE_URL, TENANT_URL } from "../support/session";
import { expectNoHorizontalOverflow, setDarkMode, shot, signedInPage, watchErrors } from "./white-label-ui";

test.describe("branding screen", () => {
  test("an owner edits the brand with a live preview, light and dark", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.owner);
    try {
      const res = await page.goto("/dashboard/settings/branding");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Branding" })).toBeVisible();
      await expect(page.getByLabel("Display name")).toHaveValue("Acme Prospecting");
      await expect(page.getByLabel("Support email")).toHaveValue("support@acme.test");
      const preview = page.getByTestId("brand-preview");
      await expect(preview).toHaveAttribute("data-brand-preview", "emerald");
      await expect(page.getByRole("radio", { name: /Emerald/ })).toBeChecked();

      // Preview only: nothing is saved, the page itself keeps the saved brand.
      await page.getByRole("radio", { name: /Violet/ }).check();
      await expect(preview).toHaveAttribute("data-brand-preview", "violet");
      await page.getByLabel("Display name").fill("Preview Name");
      await expect(page.getByTestId("preview-name")).toHaveText("Preview Name");
      await expect(page.locator("html")).toHaveAttribute("data-brand", "emerald");
      await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

      // Keyboard: arrow keys move through the colour radio group.
      await page.getByRole("radio", { name: /Violet/ }).click();
      // Radix moves focus on the next tick and selects while the key is held, as a person's key press does.
      await page.keyboard.down("ArrowRight");
      await expect(page.getByRole("radio", { name: /Blue/ })).toBeFocused();
      await page.keyboard.up("ArrowRight");
      await expect(page.getByRole("radio", { name: /Blue/ })).toBeChecked();

      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("branding-light", info.project.name), fullPage: true, caret: "initial" });

      await page.getByRole("button", { name: "Reset to defaults" }).click();
      await expect(page.getByLabel("Display name")).toHaveValue("");
      await expect(preview).toHaveAttribute("data-brand-preview", "indigo");
      await expect(page.getByTestId("preview-name")).toHaveText("Acme Outbound");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }

    const dark = await signedInPage(browser, ACME.admin);
    try {
      await setDarkMode(dark.context, BASE_URL);
      await dark.page.goto("/dashboard/settings/branding");
      await expect(dark.page.locator("html")).toHaveClass(/dark/);
      await expect(dark.page.getByTestId("brand-preview")).toBeVisible();
      await expectNoHorizontalOverflow(dark.page);
      await dark.page.screenshot({ path: shot("branding-dark", info.project.name), fullPage: true, caret: "initial" });
      expect(dark.errors).toEqual([]);
    } finally {
      await dark.context.close();
    }
  });

  for (const role of ["manager", "member", "viewer"] as const) {
    test(`a ${role} gets the not-found page`, async ({ browser }) => {
      const { context, page } = await signedInPage(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/settings/branding");
        expect(res?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Branding" })).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }

  test("the white-label sign-in page shows the workspace brand and never the installation name", async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ baseURL: TENANT_URL });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const res = await page.goto("/auth/login");
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("data-brand", "emerald");
      await expect(page.getByRole("heading", { name: "Sign in to Acme Prospecting" })).toBeVisible();
      await expect(page.getByText("support@acme.test")).toBeVisible();
      expect(await page.title()).not.toContain("AnhourLeads");
      expect(await page.locator("body").innerText()).not.toContain("AnhourLeads");
      expect(await page.content()).not.toContain("AnhourLeads");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("tenant-sign-in", info.project.name), fullPage: true, caret: "initial" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the installation's own sign-in page shows AnhourLeads", async () => {
    const api = await anonymous();
    const html = await (await api.get("/auth/login")).text();
    expect(html).toMatch(/Sign in to (<!-- -->)?AnhourLeads/);
  });
});
