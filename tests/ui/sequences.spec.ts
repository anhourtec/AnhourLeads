import { expect as baseExpect, test } from "@playwright/test";

import { createContact, suppress, uniq } from "../api/_engage";
import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, runId, shot, signedInPage } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("sequences screens", () => {
  test("a member creates a sequence and works through every tab", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/sequences"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Sequences" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sequences-member", info.project.name), fullPage: true });

      const name = `UI sequence ${runId(info.project.name)}`;
      await page.getByRole("button", { name: "Create sequence" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("button", { name: "Create sequence" }).click();
      await expect(page).toHaveURL(/\/dashboard\/sequences\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

      // Steps: the editor and merge-field help.
      await expect(page.getByLabel("Subject")).toHaveValue("Quick question, {{first_name}}");
      await expect(page.getByRole("complementary", { name: "Merge fields" })).toBeVisible();
      await page.getByRole("button", { name: "Add step" }).click();
      await expect(page.getByText("Step 2 · Automatic email")).toBeVisible();
      await page.getByLabel("Subject").nth(1).fill("Following up, {{first_name}}");
      await page.getByLabel("Body").nth(1).fill("Just checking in.");
      await page.getByRole("button", { name: "Move step 2 up" }).click();
      await expect(page.getByLabel("Subject").first()).toHaveValue("Following up, {{first_name}}");
      await page.getByRole("button", { name: "Save steps" }).click();
      await expect(page.getByText("Steps saved.")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Members can launch but not delete.
      await expect(page.getByRole("button", { name: "Activate" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

      await page.getByRole("tab", { name: /Enrolled/ }).click();
      await expect(page).toHaveURL(/tab=enrolled/, { timeout: 30_000 });
      await page.getByRole("button", { name: "Add people" }).first().click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Add people" })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: /Review queue/ }).click();
      await expect(page.getByText("Nothing to review")).toBeVisible();

      await page.getByRole("tab", { name: "Settings" }).click();
      await expect(page.getByRole("switch", { name: "Track opens" })).not.toBeChecked();
      await expect(page.getByRole("switch", { name: "Track clicks" })).not.toBeChecked();
      await expect(page.getByRole("switch", { name: "Stop on reply" })).toBeChecked();
      await page.getByLabel("Review mode").selectOption("first_step");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Settings saved.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sequence-settings-member", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("adding people shows who was skipped and why", async ({ browser }, info) => {
    const owner = await apiAs(ACME.owner);
    const created = await owner.post("/api/v1/emailer_campaigns", {
      data: { name: `UI skip ${runId(info.project.name)}` },
    });
    const sequenceId = (await created.json()).emailer_campaign.id as string;
    const marker = uniq("Skipcheck");
    const blockedEmail = `${uniq("blocked")}@example.test`;
    await createContact("acme", { firstName: "Ready", lastName: marker });
    await createContact("acme", { firstName: "Invalid", lastName: marker, emailStatus: "invalid" });
    await createContact("acme", { firstName: "Blocked", lastName: marker, email: blockedEmail });
    await suppress("acme", "email", blockedEmail);

    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      await page.goto(`/dashboard/sequences/${sequenceId}?tab=enrolled`);
      await expect(page.getByText("Nobody is enrolled yet")).toBeVisible();
      await page.getByRole("button", { name: "Add people" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("searchbox", { name: "Search people" }).fill(marker);
      const results = dialog.getByRole("list", { name: "Search results" }).getByRole("listitem");
      await expect(results).toHaveCount(3);
      for (let i = 0; i < 3; i++) await results.nth(i).getByRole("checkbox").click();
      await dialog.getByRole("button", { name: "Add 3 people" }).click();
      await expect(dialog.getByText(/Enrolled 1, skipped 2/)).toBeVisible();
      const skipped = dialog.getByRole("list", { name: "Skipped people" });
      await expect(skipped.getByText("Email is invalid")).toBeVisible();
      await expect(skipped.getByText("Email is on the do-not-contact list")).toBeVisible();
      await expect(skipped.getByText(`Blocked ${marker}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sequence-skip-report", info.project.name), fullPage: true });
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("table").getByText(`Ready ${marker}`)).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer sees sequences read-only, in dark mode", async ({ browser }, info) => {
    const owner = await apiAs(ACME.owner);
    const name = `UI viewer ${runId(info.project.name)}`;
    const created = await owner.post("/api/v1/emailer_campaigns", {
      data: { name, steps: [{ type: "auto_email", subject: "Hi {{first_name}}", body: "Hello" }] },
    });
    expect(created.status()).toBe(201);
    const { context, page, errors } = await signedInPage(browser, ACME.viewer, { dark: true });
    try {
      expect((await page.goto(`/dashboard/sequences?q=${encodeURIComponent(name)}`))?.status()).toBe(200);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("button", { name: "Create sequence" })).toHaveCount(0);
      await page.getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByLabel("Subject")).toBeDisabled();
      for (const name of ["Activate", "Pause", "Run now", "Archive", "Delete", "Save steps", "Add step"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await page.getByRole("tab", { name: /Enrolled/ }).click();
      await expect(page.getByRole("button", { name: "Add people" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Settings" }).click();
      await expect(page.getByLabel("Name")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sequence-viewer-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
