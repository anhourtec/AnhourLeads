import { expect, test } from "@playwright/test";

import { ACME, BASE_URL, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";
import { expectNoHorizontalOverflow, setDarkMode, shot, signedInPage } from "./white-label-ui";

test.describe("platform screen", () => {
  test("the platform administrator sees every workspace and its hostname limit", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      expect((await page.goto("/dashboard/platform"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
      const acme = page.getByTestId("workspace-row").filter({ hasText: "Acme Outbound", visible: true });
      await expect(acme).toBeVisible();
      await expect(acme.getByText("acme.localhost:3410")).toBeVisible();
      await expect(acme.getByLabel("Hostname limit for Acme Outbound")).toHaveValue(/^\d+$/);
      await expect(page.getByTestId("workspace-row").filter({ hasText: "Globex", visible: true })).toBeVisible();

      // An invalid value is caught before it's sent.
      const globex = page.getByTestId("workspace-row").filter({ hasText: "Globex", visible: true });
      const input = globex.getByLabel("Hostname limit for Globex");
      const before = await input.inputValue();
      await input.fill("51");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(globex.getByRole("button", { name: "Save" })).toBeDisabled();
      await input.fill(before);
      await expect(globex.getByRole("button", { name: "Save" })).toBeDisabled();

      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("platform-light", info.project.name), fullPage: true, caret: "initial" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }

    const dark = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      await setDarkMode(dark.context, BASE_URL);
      await dark.page.goto("/dashboard/platform");
      await expect(dark.page.locator("html")).toHaveClass(/dark/);
      await expectNoHorizontalOverflow(dark.page);
      await dark.page.screenshot({ path: shot("platform-dark", info.project.name), fullPage: true, caret: "initial" });
      expect(dark.errors).toEqual([]);
    } finally {
      await dark.context.close();
    }
  });

  for (const email of [ACME.owner, ACME.viewer, GLOBEX_OWNER]) {
    test(`${email} gets the not-found page`, async ({ browser }) => {
      const { context, page } = await signedInPage(browser, email);
      try {
        expect((await page.goto("/dashboard/platform"))?.status()).toBe(404);
        await expect(page.getByText("Page not found.")).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});
