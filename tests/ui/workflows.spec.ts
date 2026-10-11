import { expect as baseExpect, type Page, test } from "@playwright/test";

import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, openAsUser, realErrors, wpdShot } from "./_wp-d-ui";

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function addBlock(page: Page, label: string, wide: boolean) {
  if (wide) {
    await page.getByRole("complementary", { name: "Build" }).getByRole("button", { name: label, exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Add block" }).click();
    await page.getByRole("dialog", { name: "Add a block" }).getByRole("button", { name: label, exact: true }).click();
  }
}

test.describe("workflows screens", () => {
  test("list and templates; viewer has no create actions", async ({ browser }, info) => {
    const { context, page, errors } = await openAsUser(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/workflows");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Create workflow" }).first()).toBeVisible();
      await page.getByRole("tab", { name: "Templates" }).click();
      await expect(page.getByTestId("template-bounce-cleanup")).toBeVisible();
      await page.getByTestId("template-deal-won-notify").getByRole("button", { name: "Preview" }).click();
      await expect(page.getByRole("dialog", { name: "Celebrate won deals" })).toContainText("Deal stage changed");
      await page.keyboard.press("Escape");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: wpdShot("workflow-templates", info.project.name),
        fullPage: true,
        caret: "initial",
      });
      await page.getByRole("button", { name: "Outbound copilot" }).click();
      const copilot = page.getByRole("dialog", { name: "What can I help automate?" });
      await copilot.getByLabel("Describe what to automate").fill("when an email bounces mark them as bad data");
      await copilot.getByRole("button", { name: "Find a workflow" }).click();
      await expect(page).toHaveURL(/\/dashboard\/workflows\/[0-9a-f-]{36}/);
      await expect(page.getByLabel("Workflow name")).toHaveValue("Clean up bounced addresses");
      const id = page.url().split("/").pop() as string;
      await (await apiAs(ACME.owner)).delete(`/api/v1/workflows/${id}`);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
    const viewer = await openAsUser(browser, ACME.viewer);
    try {
      await viewer.page.goto("/dashboard/workflows");
      await expect(viewer.page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
      await expect(viewer.page.getByRole("link", { name: "Create workflow" })).toHaveCount(0);
      await expect(viewer.page.getByRole("button", { name: "Outbound copilot" })).toHaveCount(0);
      expect(realErrors(viewer.errors)).toEqual([]);
      expect((await viewer.page.goto("/dashboard/workflows/new"))?.status()).toBe(404);
    } finally {
      await viewer.context.close();
    }
  });

  test("builder: start from scratch, add a trigger and blocks, test, launch", async ({ browser }, info) => {
    const marker = `UIWF${uid()}`;
    const wide = (page: Page) => (page.viewportSize()?.width ?? 1440) >= 1024;
    const { context, page, errors } = await openAsUser(browser, ACME.member, {
      dark: info.project.name === "ui-mobile",
    });
    let id = "";
    try {
      await page.goto("/dashboard/workflows/new");
      await expect(page.getByRole("heading", { name: "What can I help automate?" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("workflow-new", info.project.name), fullPage: true, caret: "initial" });
      await page.getByRole("button", { name: "Start from scratch" }).click();
      await expect(page).toHaveURL(/\/dashboard\/workflows\/[0-9a-f-]{36}/);
      id = page.url().split("/").pop() as string;

      await page.getByTestId("trigger-card").click();
      const trigger = page.getByRole("dialog", { name: "Trigger" });
      await trigger.getByRole("button", { name: /Based on a trigger event/ }).click();
      await expect(trigger.getByRole("option", { name: "Form submitted (not available yet)" })).toBeDisabled();
      await trigger.getByLabel("Event").selectOption({ label: "Person saved or created" });
      await trigger.getByLabel("Job title contains").fill(marker);
      await expect(trigger.getByTestId("prequalified")).toContainText(/Pre-qualified: \d/);
      await page.screenshot({ path: wpdShot("workflow-trigger", info.project.name), caret: "initial" });
      await trigger.getByRole("button", { name: "Done" }).click();
      await expect(page.getByTestId("trigger-card")).toContainText("Person saved or created");

      await addBlock(page, "Delay", wide(page));
      const delay = page.getByRole("dialog", { name: "Delay" });
      await delay.getByLabel("Wait").fill("2");
      await delay.getByRole("button", { name: "Done" }).click();
      await addBlock(page, "Assign a task", wide(page));
      const task = page.getByRole("dialog", { name: "Assign a task" });
      await task.getByLabel("Task title").fill(`Call ${marker}`);
      await task.getByRole("button", { name: "Done" }).click();
      await expect(page.getByTestId("block-delay")).toBeVisible();
      await expect(page.getByTestId("block-create_task")).toContainText(`Call ${marker}`);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("workflow-builder", info.project.name), fullPage: true, caret: "initial" });

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByTestId("block-create_task")).toContainText("Give the task a title");
      await page.getByRole("button", { name: "Redo" }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Workflow saved")).toBeVisible();

      await page.getByRole("button", { name: "Launch workflow" }).click();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "More launch options" }).click();
      await page.getByRole("menuitem", { name: "Test run" }).click();
      const test_ = page.getByRole("dialog", { name: "Test run" });
      await test_.getByRole("combobox").click();
      await page.getByRole("option").first().click();
      await test_.getByRole("button", { name: "Run test" }).click();
      await expect(test_.getByTestId("test-result")).toContainText("Delay");
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: /Enrollment/ }).click();
      await expect(page.getByText("No one has enrolled yet")).toBeVisible();
      await page.getByRole("tab", { name: /Settings/ }).click();
      await expect(page.getByLabel("Allow re-enrollment")).toBeChecked();
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
      if (id) await (await apiAs(ACME.owner)).post(`/api/v1/workflows/${id}/archive`);
    }
  });

  test("entry points from search and lists prefill the criteria", async ({ browser }) => {
    const owner = await apiAs(ACME.owner);
    const listRes = await owner.post("/api/v1/labels", { data: { name: `WF entry ${uid()}`, entityType: "contact" } });
    const listId = (await listRes.json()).label.id as string;
    const { context, page, errors } = await openAsUser(browser, ACME.member);
    const ids: string[] = [];
    try {
      const filters = encodeURIComponent(
        JSON.stringify({ titles: ["VP Sales"], country: ["Germany"], technologies: ["x"] }),
      );
      await page.goto(`/dashboard/workflows/new?from=search&entity=contact&filters=${filters}`);
      await expect(page.getByText("Starts with your search criteria.")).toContainText('title contains "VP Sales"');
      await expect(page.getByText("Starts with your search criteria.")).toContainText("technologies");
      await page.getByRole("button", { name: "Start from scratch" }).click();
      await expect(page).toHaveURL(/\/dashboard\/workflows\/[0-9a-f-]{36}/);
      ids.push(page.url().split("/").pop() as string);
      await expect(page.getByTestId("trigger-card")).toHaveCount(1);
      const wf = (await (await owner.get(`/api/v1/workflows/${ids[0]}`)).json()).workflow;
      expect(wf.enrollmentFilters).toEqual({ title: "VP Sales", country: ["Germany"] });

      await page.goto(`/dashboard/workflows/new?from=list&listId=${listId}`);
      await expect(page.getByText(/Starts with people in the list/)).toBeVisible();
      await page.getByRole("button", { name: "Start from scratch" }).click();
      await expect(page).toHaveURL(/\/dashboard\/workflows\/[0-9a-f-]{36}/);
      ids.push(page.url().split("/").pop() as string);
      await expect(page.getByTestId("trigger-card")).toContainText("Added to a list");
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
      for (const id of ids) await owner.delete(`/api/v1/workflows/${id}`);
    }
  });

  test("viewer opens a workflow read-only", async ({ browser }) => {
    const owner = await apiAs(ACME.owner);
    const created = await owner.post("/api/v1/workflows", { data: { templateId: "replied-follow-up" } });
    const id = (await created.json()).workflow.id as string;
    const { context, page, errors } = await openAsUser(browser, ACME.viewer);
    try {
      await page.goto(`/dashboard/workflows/${id}`);
      await expect(page.getByLabel("Workflow name")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Launch workflow" })).toBeDisabled();
      await expect(page.getByRole("complementary", { name: "Build" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
      await owner.delete(`/api/v1/workflows/${id}`);
    }
  });
});
