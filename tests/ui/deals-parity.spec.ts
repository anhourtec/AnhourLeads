import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, openAsUser, realErrors, wpdShot } from "./_wp-d-ui";

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe("deals parity screen", () => {
  test("first visit: intro modal, setup as owner, success, create deal", async ({ browser }, info) => {
    const { context, page, errors } = await openAsUser(browser, ACME.owner, { showIntro: true });
    try {
      await page.goto("/dashboard/deals");
      const intro = page.getByRole("dialog", { name: "Deal management made easy" });
      await expect(intro).toBeVisible();
      await page.screenshot({ path: wpdShot("deals-intro", info.project.name), caret: "initial" });
      await intro.getByRole("button", { name: "Begin setup" }).click();
      await expect(page).toHaveURL(/\/dashboard\/deals\/setup/);
      await expect(page.getByRole("heading", { name: "How would you like to start?" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Not available yet" })).toBeDisabled();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Now, add your pipeline details" })).toBeVisible();
      await expect(page.getByLabel("Pipeline name")).toBeEnabled();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("deals-setup", info.project.name), fullPage: true, caret: "initial" });
      await page.getByRole("button", { name: "Finish setup" }).click();
      const done = page.getByRole("dialog", { name: "You're all set up" });
      await expect(done).toBeVisible();
      await done.getByRole("button", { name: "Create deal" }).click();
      await expect(page.getByRole("dialog", { name: "Create deal" })).toBeVisible();
      // The intro is remembered.
      await page.goto("/dashboard/deals");
      await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Deal management made easy" })).toHaveCount(0);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("setup is read-only for a member", async ({ browser }) => {
    const { context, page, errors } = await openAsUser(browser, ACME.member);
    try {
      await page.goto("/dashboard/deals/setup");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("only an administrator or owner can change it")).toBeVisible();
      await expect(page.getByLabel("Pipeline name")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Finish setup" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const role of ROLES) {
    test(`board renders for ${role}`, async ({ browser }) => {
      const { context, page, errors } = await openAsUser(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/deals");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
        await expect(page.locator("[data-stage-name='Closed won']")).toHaveCount(1);
        await expect(page.locator("[data-stage-name='Closed lost']")).toHaveCount(1);
        const create = page.getByRole("button", { name: "Create deal", exact: true });
        if (can(role, "deal:create")) {
          await expect(create).toBeVisible();
          await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
        } else {
          await expect(create).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);
        expect(realErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("a member creates a deal in the modal, drags it to another stage, opens it, sees the table", async ({
    browser,
  }, info) => {
    const name = `UI parity ${uid()}`;
    // A pipeline of its own keeps the columns short and the test independent of other deals.
    const admin = await apiAs(ACME.admin);
    const created = await admin.post("/api/v1/pipelines", { data: { name: `UI board ${uid()}` } });
    const pipelineId = (await created.json()).pipeline.id as string;
    const { context, page, errors } = await openAsUser(browser, ACME.member, {
      dark: info.project.name === "ui-tablet",
    });
    try {
      await page.goto(`/dashboard/deals?pipeline=${pipelineId}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Create deal", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create deal" });
      await expect(dialog.getByRole("link", { name: "Customize deal form" })).toHaveAttribute(
        "href",
        /custom-fields\?tab=deal/,
      );
      await dialog.getByLabel("Deal name").fill(name);
      await dialog.getByLabel("Stage").selectOption({ label: "Lead" });
      await dialog.getByLabel("Amount").fill("15000");
      await page.screenshot({ path: wpdShot("deals-create-modal", info.project.name), caret: "initial" });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toBeHidden();

      const lead = page.locator("[data-stage-name='Lead']");
      const meeting = page.locator("[data-stage-name='Meeting booked']");
      const card = lead.getByRole("button", { name: new RegExp(name) });
      await expect(card).toBeVisible();
      if (info.project.name !== "ui-desktop") {
        // Narrow screens (touch, or a board wider than the screen) move deals from the drawer.
        await card.click();
        const drawer = page.getByRole("dialog", { name });
        await drawer.getByLabel("Stage").selectOption({ label: "Meeting booked" });
        await page.keyboard.press("Escape");
      } else {
        await card.dragTo(meeting);
      }
      await expect(meeting.getByRole("button", { name: new RegExp(name) })).toBeVisible();
      const api = await apiAs(ACME.member);
      await expect
        .poll(async () => {
          const body = await (await api.post("/api/v1/opportunities/search", { data: { q: name } })).json();
          return body.opportunities[0]?.stageName;
        })
        .toBe("Meeting booked");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("deals-board", info.project.name), fullPage: true, caret: "initial" });

      await meeting.getByRole("button", { name: new RegExp(name) }).click();
      const drawer = page.getByRole("dialog", { name });
      await expect(drawer.getByRole("heading", { name: "Activity" })).toBeVisible();
      await expect(drawer.getByText(/Moved from Lead to Meeting booked/)).toBeVisible();
      await drawer.getByLabel("New note").fill("Spoke to procurement");
      await drawer.getByRole("button", { name: "Add note" }).click();
      await expect(drawer.getByText("Spoke to procurement")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("radio", { name: "Table" }).click();
      await expect(page).toHaveURL(/viewMode=table/);
      await expect(page.getByRole("row").filter({ hasText: name })).toContainText("$15,000");
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
      const list = (await (await admin.get("/api/v1/pipelines")).json()).pipelines as {
        id: string;
        isDefault: boolean;
      }[];
      const fallback = list.find((p) => p.isDefault)?.id;
      await admin.delete(`/api/v1/pipelines/${pipelineId}`, { data: { moveDealsToPipelineId: fallback } });
    }
  });

  test("?new=1&contactId opens the create form with the person and their company", async ({ browser }) => {
    const owner = await apiAs(ACME.owner);
    const tag = uid();
    const account = await owner.post("/api/v1/accounts", {
      data: { name: `Prefill Co ${tag}`, domain: `prefill-${tag}.example.test` },
    });
    const companyId = (await account.json()).account.id as string;
    const person = await owner.post("/api/v1/contacts", {
      data: { firstName: "Prefill", lastName: tag, email: `prefill-${tag}@example.test`, companyId },
    });
    const contactId = (await person.json()).contact.id as string;
    const { context, page, errors } = await openAsUser(browser, ACME.member, { showIntro: true });
    try {
      await page.goto(`/dashboard/deals?new=1&contactId=${contactId}`);
      const dialog = page.getByRole("dialog", { name: "Create deal" });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("#deal-contact")).toContainText(`Prefill ${tag}`);
      await expect(dialog.locator("#deal-company")).toContainText(`Prefill Co ${tag}`);
      await expect(page.getByRole("dialog", { name: "Deal management made easy" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("filters and analytics tab", async ({ browser }, info) => {
    const { context, page, errors } = await openAsUser(browser, ACME.manager);
    try {
      await page.goto("/dashboard/deals");
      await page.getByRole("button", { name: "Show filters" }).click();
      const filters = page.getByRole("form", { name: "Deal filters" });
      await filters.getByLabel("Minimum amount").fill("1");
      await filters.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/amountMin=1/);
      await expectNoHorizontalOverflow(page);
      await page.getByRole("tab", { name: /Analytics/ }).click();
      await expect(page).toHaveURL(/tab=analytics/);
      await expect(page.getByTestId("deals-analytics")).toBeVisible();
      await expect(page.getByText("Win rate")).toBeVisible();
      await expect(page.getByText("Pipeline value by stage")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("deals-analytics", info.project.name), fullPage: true, caret: "initial" });
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("pipeline settings: admin creates and deletes a pipeline; members get 404", async ({ browser }, info) => {
    const { context, page, errors } = await openAsUser(browser, ACME.admin);
    const name = `UI pipe ${uid()}`;
    try {
      await page.goto("/dashboard/settings/pipelines");
      await expect(page.getByRole("heading", { level: 1, name: "Deal pipelines" })).toBeVisible();
      await page.getByRole("button", { name: "Create pipeline" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Create pipeline" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("button", { name: "Create pipeline" }).click();
      await expect(page.getByLabel("Pipeline name")).toHaveValue(name);
      await page.getByRole("button", { name: "Add stage" }).click();
      await page.getByLabel("Stage 6 name").fill("Security review");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Pipeline saved")).toBeVisible();
      await expect(page.getByLabel("Stage 6 name")).toHaveValue("Security review");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: wpdShot("pipeline-settings", info.project.name),
        fullPage: true,
        caret: "initial",
      });
      await page.getByRole("button", { name: "Delete pipeline" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete pipeline" }).click();
      await expect(page.getByRole("navigation", { name: "Pipelines" }).getByText(name)).toHaveCount(0);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
    const member = await openAsUser(browser, ACME.member);
    try {
      const res = await member.page.goto("/dashboard/settings/pipelines");
      expect(res?.status()).toBe(404);
    } finally {
      await member.context.close();
    }
  });
});
