import { expect as baseExpect, test } from "@playwright/test";

import { uniq } from "../api/admin-helpers";
import { BASE_URL, PASSWORD } from "../support/session";
import { expectNoHorizontalOverflow, watchErrors } from "./admin-ui";
import { openSidebar, ownErrors, wpaShot } from "./shell-ui";

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.describe("onboarding", () => {
  test("register → questions → goals → connect email step → skip → home", async ({ browser }, info) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const errors = watchErrors(page);
    const email = `${uniq("onboard")}@example.com`.toLowerCase();
    try {
      await page.goto("/auth/register");
      await page.getByLabel("Your name").fill("Olivia Onboard");
      await page.getByLabel("Workspace name").fill(`Onboard ${uniq("ws")}`);
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Create workspace" }).click();

      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByText("Question 1 of 2")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: /Welcome, Olivia/ })).toBeVisible();
      const next = page.getByRole("button", { name: "Continue" });
      await expect(next).toBeDisabled();
      await page.getByLabel("Sales leader").check();
      await page.getByLabel("11–50").check();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("onboarding-1", info.project.name), fullPage: true });
      await next.click();

      await expect(page.getByText("Question 2 of 2")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "How do you want to start?" })).toBeVisible();
      for (const goal of ["Outbound", "Inbound", "Enrichment", "Deal execution"]) {
        await expect(page.getByRole("button", { name: `Select: ${goal}` })).toBeVisible();
      }
      await page.getByRole("button", { name: "Select: Outbound" }).click();
      await page.getByRole("button", { name: "Select: Deal execution" }).click();
      await expect(page.getByRole("button", { name: "Selected: Outbound" })).toHaveAttribute("aria-pressed", "true");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("onboarding-2", info.project.name), fullPage: true });
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByRole("heading", { level: 1, name: "Connect your email to get started" })).toBeVisible();
      const connect = page.getByRole("button", { name: "Connect email" });
      await expect(connect).toBeDisabled();
      await page.getByLabel(/^Google/).check();
      await expect(page.getByText(/Signing in with Google is coming soon/)).toBeVisible();
      await expect(connect).toBeDisabled();
      await page.getByLabel(/I'll follow this workspace's terms/).check();
      await expect(connect).toBeEnabled();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpaShot("onboarding-3", info.project.name), fullPage: true });

      // Back keeps the answers.
      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByRole("button", { name: "Selected: Deal execution" })).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();

      await expect(page).toHaveURL(/\/dashboard\/home$/);
      await expect(page.getByRole("heading", { level: 1, name: /Get started with/ })).toBeVisible();
      const state = (await (await page.request.get("/api/v1/onboarding")).json()).onboarding;
      expect(state).toMatchObject({ role: "sales_leader", teamSize: "11_50", goals: ["outbound", "deal_execution"] });
      expect(state.finishedAt).not.toBeNull();
      expect(state.antiSpamAcceptedAt).not.toBeNull();

      // Finished: the dashboard no longer sends them back, and /onboarding goes home.
      await page.goto("/onboarding");
      await expect(page).toHaveURL(/\/dashboard\/home$/);

      // The onboarding hub card can be hidden from the sidebar.
      const sidebar = await openSidebar(page, info.project.name);
      const card = sidebar.getByTestId("onboarding-hub-card");
      await expect(card).toBeVisible();
      await expect(card.getByText(/% completed/)).toBeVisible();
      // Retry in case the click lands before the sidebar has hydrated.
      await expect(async () => {
        if (await card.count()) await card.getByRole("button", { name: "Hide onboarding hub" }).click();
        await expect(card).toHaveCount(0, { timeout: 2_000 });
      }).toPass();
      await expect
        .poll(async () => (await (await page.request.get("/api/v1/onboarding")).json()).onboarding.hubDismissedAt)
        .not.toBeNull();
      await page.reload();
      await expect((await openSidebar(page, info.project.name)).getByTestId("onboarding-hub-card")).toHaveCount(0);
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("someone who hasn't finished is sent to onboarding from any app page", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const email = `${uniq("redirect")}@example.com`.toLowerCase();
      const signUp = await page.request.post("/api/auth/sign-up/email", {
        data: { email, password: PASSWORD, name: "Rita Redirect" },
        headers: { origin: BASE_URL },
      });
      expect(signUp.status()).toBe(200);
      const register = await page.request.post("/api/v1/workspaces/register", {
        data: { workspaceName: `Redirect ${uniq("ws")}` },
        headers: { origin: BASE_URL },
      });
      expect(register.status()).toBe(201);
      for (const path of ["/dashboard/home", "/dashboard/people", "/dashboard/settings"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/onboarding$/);
      }
      await expect(page.getByText("Question 1 of 2")).toBeVisible();
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
