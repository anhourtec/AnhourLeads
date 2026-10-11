import { expect as baseExpect, test } from "@playwright/test";

import { can, type Role } from "../../src/lib/rbac/permissions";
import { cleanSearchIndex, closeDiscoDb, seedSearchIndex } from "../support/discovery-fixtures";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

/**
 * Find people / Find companies over the shared discovery index: Total and Net new show index rows
 * (flagged when saved), Saved shows the workspace's own records. Save, Access email, the company
 * sheet, role gating, filters that only apply to saved records, and the no-match state.
 */

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (name: string, project: string) => `.playwright-mcp/discovery-search/${name}-${project}.png`;

test.afterAll(async () => {
  await closeDiscoDb();
});

test.describe("find people and companies over the shared database", () => {
  test("owner: tabs, save a person, access an email, company sheet, save a company", async ({ browser }, info) => {
    const tag = `ui${uid()}`;
    const fx = await seedSearchIndex(tag);
    const { context, page, errors } = await openAs(browser, ACME.owner);
    try {
      expect((await page.goto(`/dashboard/people?company=Lumen+${tag}`))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      const results = page.getByTestId("index-results");
      await expect(results).toBeVisible();
      if ((page.viewportSize()?.width ?? 1440) >= 1024) {
        const rail = page.getByRole("complementary", { name: "Filters" });
        await expect(rail.getByRole("radio", { name: /Total/ })).toBeChecked();
        await expect(rail.getByRole("radio", { name: /Net new/ })).not.toBeChecked();
      }
      await expect(results.getByRole("button", { name: `Nora ${tag}`, exact: true })).toBeVisible();
      await expect(results.getByRole("button", { name: `Omar ${tag}`, exact: true })).toBeVisible();
      // Emails stay hidden until accessed.
      await expect(page.getByText(`nora@lumen.${tag}.search.test`)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-total", info.project.name) });

      // Save Omar: the row turns Saved and links to the workspace record.
      const omarRow = page.locator(`tr[data-index-id="${fx.people.omar}"]`);
      await omarRow.getByRole("button", { name: `Save Omar ${tag}` }).click();
      await expect(page.getByText("Saved 1 person.")).toBeVisible();
      await expect(omarRow.getByRole("link", { name: "Saved" })).toHaveAttribute("href", /\/dashboard\/people\//);

      // Net new leaves him out; Saved shows the workspace contact.
      await page.goto(`/dashboard/people?company=Lumen+${tag}&segment=net_new`);
      await page.waitForLoadState("networkidle");
      await expect(results.getByRole("button", { name: `Nora ${tag}`, exact: true })).toBeVisible();
      await expect(results.getByRole("button", { name: `Omar ${tag}`, exact: true })).toHaveCount(0);
      await page.goto(`/dashboard/people?company=Lumen+${tag}&segment=saved`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("link", { name: `Omar ${tag}`, exact: true })).toBeVisible();
      await expect(page.getByTestId("index-results")).toHaveCount(0);

      // Access email for Nora: saves her and reveals the published address.
      await page.goto(`/dashboard/people?company=Lumen+${tag}&segment=total`);
      await page.waitForLoadState("networkidle");
      const noraRow = page.locator(`tr[data-index-id="${fx.people.nora}"]`);
      await noraRow.getByRole("button", { name: `Access email for Nora ${tag}` }).click();
      await expect(noraRow.getByText(`nora@lumen.${tag}.search.test`)).toBeVisible();
      await expect(noraRow.getByRole("link", { name: "Saved" })).toBeVisible();

      // Person sheet, then the company sheet from it.
      await noraRow.getByRole("button", { name: `Nora ${tag}`, exact: true }).click();
      const personSheet = page.getByRole("dialog", { name: `Nora ${tag}` });
      await expect(personSheet.getByText("Chief Executive Officer").first()).toBeVisible();
      await personSheet.getByRole("button", { name: `Lumen ${tag} Robotics` }).click();
      const companySheet = page.getByRole("dialog", { name: `Company: Lumen ${tag} Robotics` });
      // Accessing Nora's email saved Lumen too (the role may create companies).
      await expect(companySheet.getByRole("link", { name: "Saved · open record" })).toBeVisible();
      await expect(companySheet.getByRole("list", { name: "People" }).getByText(`Omar ${tag}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("company-sheet", info.project.name) });
      await page.keyboard.press("Escape");
      await expect(companySheet).toBeHidden();

      // Find companies: Total shows the index company; save it.
      await page.goto(`/dashboard/companies?company=Quarry+${tag}`);
      await page.waitForLoadState("networkidle");
      const quarryRow = page.locator(`tr[data-index-id="${fx.companies.quarry}"]`);
      await expect(quarryRow.getByText(`quarry.${tag}.search.test`)).toBeVisible();
      await quarryRow.getByRole("button", { name: `Save Quarry ${tag} Analytics` }).click();
      await expect(page.getByText("Saved 1 company.")).toBeVisible();
      await expect(quarryRow.getByRole("link", { name: "Saved" })).toHaveAttribute("href", /\/dashboard\/companies\//);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("companies-total", info.project.name) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await cleanSearchIndex(tag);
    }
  });

  test("viewer sees index rows without save or access controls; dark mode", async ({ browser }, info) => {
    const tag = `ui${uid()}`;
    const fx = await seedSearchIndex(tag);
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await page.goto(`/dashboard/people?company=Lumen+${tag}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(/dark/);
      const noraRow = page.locator(`tr[data-index-id="${fx.people.nora}"]`);
      await expect(noraRow.getByRole("button", { name: `Nora ${tag}`, exact: true })).toBeVisible();
      await expect(noraRow.getByText("Published, hidden")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Access email/ })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Select Nora ${tag}` })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-viewer-dark", info.project.name) });

      await noraRow.getByRole("button", { name: `Lumen ${tag} Robotics` }).click();
      const sheet = page.getByRole("dialog", { name: `Company: Lumen ${tag} Robotics` });
      await expect(sheet.getByRole("list", { name: "People" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /Save/ })).toHaveCount(0);
      await page.keyboard.press("Escape");

      await page.goto(`/dashboard/companies?company=Quarry+${tag}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(`tr[data-index-id="${fx.companies.quarry}"]`)).toBeVisible();
      await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await cleanSearchIndex(tag);
    }
  });

  for (const role of ["member", "manager"] as Role[]) {
    test(`${role}: save and access controls follow the matrix`, async ({ browser }) => {
      const tag = `ui${uid()}`;
      const fx = await seedSearchIndex(tag);
      const { context, page, errors } = await openAs(browser, ACME[role]);
      try {
        await page.goto(`/dashboard/people?company=Lumen+${tag}`);
        await page.waitForLoadState("networkidle");
        const row = page.locator(`tr[data-index-id="${fx.people.omar}"]`);
        await expect(row).toBeVisible();
        await expect(row.getByRole("button", { name: `Save Omar ${tag}` })).toHaveCount(
          can(role, "contact:create") ? 1 : 0,
        );
        await expect(row.getByRole("button", { name: `Access email for Omar ${tag}` })).toHaveCount(
          can(role, "enrich:run") && can(role, "contact:create") ? 1 : 0,
        );
        // Bulk: select both people, the bar offers Save.
        await page.getByRole("checkbox", { name: "Select all people on this page" }).click();
        const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
        await expect(bulk.getByRole("button", { name: "Save 2 people" })).toBeVisible();
        await bulk.getByRole("button", { name: /Clear 2 selected/ }).click();
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await cleanSearchIndex(tag);
      }
    });
  }

  test("saved-only filters are disabled and listed; no-match state", async ({ browser }, info) => {
    const tag = `ui${uid()}`;
    await seedSearchIndex(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto(`/dashboard/people?company=Lumen+${tag}&stage=new`);
      await page.waitForLoadState("networkidle");
      const note = page.getByRole("note");
      await expect(note).toContainText("Not applied to the shared database");
      await expect(note).toContainText("Stage");
      await expect(page.getByTestId("index-results")).toBeVisible();
      if ((page.viewportSize()?.width ?? 1440) >= 1024) {
        const rail = page.getByRole("complementary", { name: "Filters" });
        await expect(rail.getByRole("region", { name: "Email status (saved records only)" })).toBeVisible();
      }
      await note.getByRole("button", { name: "Show saved" }).click();
      await expect(page).toHaveURL(/segment=saved/);
      await expect(page.getByRole("note")).toHaveCount(0);

      await page.goto(`/dashboard/people?company=Nothing+matches+${tag}&segment=total`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("No people match these filters")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("no-match", info.project.name) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await cleanSearchIndex(tag);
    }
  });
});
