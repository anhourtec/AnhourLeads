import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 120_000 });

const expect = baseExpect.configure({ timeout: 20_000 });

test.describe("import wizard", () => {
  test("member maps columns, picks settings and imports into a new list", async ({ browser }, info) => {
    const tag = uid();
    const fileName = `wizard-${tag}.csv`;
    const csv = [
      "First name,Last name,Email,Job,Nickname",
      `Una,Wizard,una-${tag}@ui-import.example,Head of tests,U`,
      `Vic,Wizard,vic-${tag}@ui-import.example,Engineer,V`,
    ].join("\n");
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/import?type=contacts");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Import" })).toBeVisible();
      const card = page.getByTestId("import-card-contacts");
      await expect(card.getByRole("button", { name: "Select CSV file" })).toBeDisabled();
      await expect(card.getByRole("link", { name: "Download sample template" })).toHaveAttribute(
        "href",
        "/api/v1/contacts/import/template",
      );
      await expectNoHorizontalOverflow(page);
      await card.getByRole("checkbox").click();
      await expect(card.getByRole("button", { name: "Select CSV file" })).toBeEnabled();
      await page.getByTestId("import-file-contacts").setInputFiles({
        name: fileName,
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });

      await expect(page.getByRole("heading", { level: 1, name: "Import contacts" })).toBeVisible();
      await expect(page.getByText("rows included")).toContainText("2");
      await expect(page.getByText("columns detected")).toContainText("5");
      await expect(page.getByTestId("mapping-card")).toHaveCount(5);
      await page.getByLabel("Field for Job").selectOption({ label: "Job title" });
      await expect(page.getByLabel("Field for Nickname")).toHaveValue("");
      await page.getByLabel("Hide recognised columns").click();
      await expect(page.getByTestId("mapping-card")).toHaveCount(2);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-b/import-${info.project.name}.png`, fullPage: true });

      await page.getByLabel("Stage").selectOption({ label: "Set every record to Interested" });
      await page.getByLabel("Add to a list").selectOption("new");
      await page.getByLabel("New list name").fill(`Imported ${tag}`);
      await page.getByRole("tab", { name: "Data enrichment" }).click();
      await expect(page.getByLabel("Find missing email addresses")).toBeEnabled();
      await page.getByRole("tab", { name: "Settings" }).click();
      await page.getByRole("button", { name: "Import", exact: true }).click();

      await expect(page.getByText("Import finished")).toBeVisible();
      await expect(page.getByTestId("import-created")).toHaveText("2");
      await expect(page.getByTestId("import-skipped")).toHaveText("0");
      await expect(page.getByRole("link", { name: `Open Imported ${tag}` })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-b/import-result-${info.project.name}.png`, fullPage: true });

      const found = await (
        await (await api(ACME.owner)).post("/api/v1/contacts/search", { data: { q: `-${tag}@ui-import` } })
      ).json();
      expect(found.contacts).toHaveLength(2);
      for (const c of found.contacts) {
        expect(c.stage).toBe("interested");
        expect(["Head of tests", "Engineer"]).toContain(c.title);
      }

      await page.goto("/dashboard/settings/imports");
      await expect(page.getByRole("heading", { level: 1, name: "Imports and exports" })).toBeVisible();
      await expect(page.getByRole("cell", { name: fileName })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("errors are listed and the file can be removed", async ({ browser }) => {
    const tag = uid();
    const { context, page, errors } = await openAs(browser, ACME.owner, { dark: true });
    try {
      await page.goto("/dashboard/import");
      const card = page.getByTestId("import-card-accounts");
      await card.getByRole("checkbox").click();
      await page.getByTestId("import-file-accounts").setInputFiles({
        name: `accounts-${tag}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(`Company name,Domain\nGood ${tag},${tag}.ui-import.example\nBad ${tag},not a domain\n`),
      });
      await expect(page.getByRole("heading", { level: 1, name: "Import accounts" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Data enrichment" })).toHaveCount(0);
      await page.getByRole("button", { name: "Remove file" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Import" })).toBeVisible();

      await page.getByTestId("import-card-accounts").getByRole("checkbox").click();
      await page.getByTestId("import-file-accounts").setInputFiles({
        name: `accounts-${tag}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(`Company name,Domain\nGood ${tag},${tag}.ui-import.example\nBad ${tag},not a domain\n`),
      });
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await expect(page.getByTestId("import-created")).toHaveText("1");
      await expect(page.getByRole("heading", { name: "Rows that weren't imported" })).toBeVisible();
      await expect(page.getByRole("cell", { name: "The domain doesn't look valid." })).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download errors" }).click();
      expect((await download).suggestedFilename()).toBe(`accounts-${tag}-errors.csv`);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer can't open the import wizard", async ({ browser }) => {
    const { context, page } = await openAs(browser, ACME.viewer);
    try {
      await page.goto("/dashboard/import");
      await expect(page).toHaveURL(/unauthorized/);
      await page.goto("/dashboard/settings/imports");
      await expect(page.getByRole("heading", { level: 1, name: "Imports and exports" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Import CSV" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
