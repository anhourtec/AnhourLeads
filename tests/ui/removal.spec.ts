import { expect, test } from "@playwright/test";

import { BASE_URL, newUiContext } from "../support/session";
import { expectNoHorizontalOverflow, setDarkMode, watchErrors } from "./white-label-ui";

/** The public removal-request page (/privacy/removal): no sign-in, works at every width. */

const shot = (name: string, project: string) => `.playwright-mcp/wp-f/removal-${project}-${name}.png`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe("public removal page", () => {
  test("an email request ends with 'check your inbox'", async ({ browser }, info) => {
    const context = await newUiContext(browser, { baseURL: BASE_URL });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      expect((await page.goto("/privacy/removal"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Remove your information" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("form", info.project.name), fullPage: true });

      // Empty submit shows an inline error.
      await page.getByRole("button", { name: "Send removal request" }).click();
      await expect(page.getByText("Enter your email address.")).toBeVisible();

      await page.getByLabel("Email address").fill(`ui-${uid()}@removal-ui.disco.test`);
      await page.getByLabel("Reason (optional)").fill("Testing the removal flow");
      await page.getByRole("button", { name: "Send removal request" }).click();
      await expect(page.getByText("Check your inbox")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("email-sent", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a domain request shows the DNS record to add, in dark mode too", async ({ browser }, info) => {
    const context = await newUiContext(browser, { baseURL: BASE_URL });
    await setDarkMode(context, BASE_URL);
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await page.goto("/privacy/removal");
      await page.getByRole("radio", { name: "A whole domain" }).click();
      await page.getByLabel("Domain", { exact: true }).fill(`ui-${uid()}.disco.test`);
      await page.getByRole("button", { name: "Send removal request" }).click();
      await expect(page.getByTestId("txt-record")).toHaveText(/^anhour-optout=[A-Za-z0-9_-]+$/);
      await page.getByRole("button", { name: "Check DNS now" }).click();
      await expect(page.getByText(/wasn't found on/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("domain-dns-dark", info.project.name), fullPage: true });
      // The failed DNS check is an expected 409 from the API; nothing else may log an error.
      expect(errors.filter((e) => !e.includes("409"))).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
