import { expect as baseExpect, test } from "@playwright/test";

import { ROLES } from "../../src/lib/rbac/permissions";
import { freshWorkspace } from "../api/admin-helpers";
import { ACME, BASE_URL, newUiContext } from "../support/session";
import { expectNoHorizontalOverflow, openAs, watchErrors } from "./admin-ui";
import { ownErrors, wpaShot } from "./shell-ui";

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.describe("home", () => {
  test("layouts switch and persist: getting started, generate pipeline, win & close", async ({ browser }, info) => {
    // A fresh owner, so switching layouts never races the other screen sizes' runs.
    const fresh = await freshWorkspace();
    await fresh.api.patch("/api/v1/onboarding", {
      data: { goals: ["outbound"], finished: true, outcome: "email_skipped" },
    });
    const context = await newUiContext(browser, { baseURL: BASE_URL, storageState: await fresh.api.storageState() });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const res = await page.goto("/dashboard/overview");
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\/home$/);
      await expect(page.getByRole("heading", { level: 1, name: /Get started with/ })).toBeVisible();
      const cards = page.getByTestId("checklist-card");
      await expect(cards.first()).toBeVisible();
      await expect(cards.first().getByText(/\d+ of \d+ completed/)).toBeVisible();
      // Outbound was the goal, so the prospecting card leads.
      await expect(cards.first()).toContainText("Start reaching the right prospects");
      await expect(cards.first().getByRole("link", { name: "Save a prospect" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("home-getting-started", info.project.name), fullPage: true });

      await page.getByRole("button", { name: /Home layout: Getting started/ }).click();
      await expect(page.getByRole("tab", { name: "System" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Your layouts" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Starred" })).toBeVisible();
      await page.getByRole("button", { name: /^Generate pipeline/ }).click();
      await expect(page.getByText("Suggested leads")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: /Welcome, Fresh/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: "People" })).toBeVisible();
      await expect(page.getByText("No suggestions yet")).toBeVisible();
      await page.getByRole("radio", { name: "Companies" }).click();
      await expect(page.getByRole("link", { name: "Find companies" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("home-generate-pipeline", info.project.name), fullPage: true });

      await page.getByRole("button", { name: /Home layout: Generate pipeline/ }).click();
      await page.getByRole("button", { name: /^Win & close/ }).click();
      await expect(page.getByText("Your email stats")).toBeVisible();
      await expect(page.getByText("Recent replies")).toBeVisible();
      await expect(page.getByText("Your tasks")).toBeVisible();
      await expect(page.getByText("Deals for follow-up")).toBeVisible();
      await expect(page.getByText("Mailbox", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("home-win-and-close", info.project.name), fullPage: true });

      await page.reload();
      await expect(page.getByText("Your email stats")).toBeVisible();
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const role of ROLES) {
    test(`renders the saved layout for ${role}`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "viewer" });
      try {
        const res = await page.goto("/dashboard/home");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("button", { name: /Home layout:/ })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByText("This page couldn't load")).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        if (role === "member" || role === "viewer") {
          await page.screenshot({ path: wpaShot(`home-${role}`, info.project.name), fullPage: true });
        }
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("onboarding hub lists the checklist and, for admins, workspace setup", async ({ browser }, info) => {
    for (const role of ["owner", "member"] as const) {
      const { context, page, errors } = await openAs(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/onboarding-hub");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Onboarding hub" })).toBeVisible();
        await expect(page.getByTestId("checklist-card").first()).toBeVisible();
        await expect(page.getByText("Workspace setup", { exact: true })).toHaveCount(role === "owner" ? 1 : 0);
        await expectNoHorizontalOverflow(page);
        if (role === "owner")
          await page.screenshot({ path: wpaShot("onboarding-hub", info.project.name), fullPage: true });
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
});
