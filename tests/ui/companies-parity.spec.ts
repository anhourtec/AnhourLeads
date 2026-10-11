import { expect as baseExpect, type Page, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 150_000 });

const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (name: string, project: string) => `.playwright-mcp/wp-b/${name}-${project}.png`;

async function seed(tag: string) {
  const owner = await api(ACME.owner);
  const made: { id: string; name: string }[] = [];
  for (const [suffix, employees, industry] of [
    ["Small", 8, "Retail"],
    ["Mid", 150, "Retail"],
    ["Large", 20_000, "Energy"],
  ] as const) {
    const res = await owner.post("/api/v1/accounts", {
      data: {
        name: `Coparity ${tag} ${suffix}`,
        domain: `coparity-${tag}-${suffix.toLowerCase()}.example`,
        employeeCount: employees,
        industry,
        keywords: ["parity", suffix.toLowerCase()],
        technologies: suffix === "Mid" ? ["Stripe"] : [],
        description: "A company created by the parity tests. ".repeat(10),
        foundedYear: 2010,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    made.push((await res.json()).account);
  }
  return made;
}

async function openRail(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 1024) return page.getByRole("complementary", { name: "Filters" });
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("find companies (Apollo parity)", () => {
  test("employee ranges with counts, chips, save and the company page", async ({ browser }, info) => {
    const tag = uid();
    const [small, mid, large] = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      expect((await page.goto(`/dashboard/companies?company=${encodeURIComponent(`Coparity ${tag}`)}`))?.status()).toBe(
        200,
      );
      await expect(page.getByRole("heading", { level: 1, name: "Find companies" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Number of employees" })).toBeVisible();
      for (const c of [small, mid, large])
        await expect(page.getByRole("link", { name: c.name, exact: true })).toBeVisible();

      // # Employees with facet counts.
      const rail = await openRail(page);
      await rail.getByRole("button", { name: "Expand # Employees" }).click();
      await expect(rail.getByRole("checkbox", { name: /^10,001\+.*\(1\)/ })).toBeVisible();
      await rail.getByRole("checkbox", { name: /^101–200/ }).click();
      await expect(page).toHaveURL(/employeeRanges=101-200/);
      if ((page.viewportSize()?.width ?? 1440) < 1024) await page.keyboard.press("Escape");
      await expect(page.getByRole("link", { name: mid.name, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: small.name, exact: true })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("companies-results", info.project.name) });

      // Save (assign to me) from the row.
      await page.getByRole("button", { name: `Save ${mid.name}` }).click();
      await expect(page.getByRole("button", { name: `${mid.name} is saved to you` })).toBeVisible();

      // Company page.
      await page.getByRole("link", { name: mid.name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: mid.name })).toBeVisible();
      await expect(page.getByText("Company details")).toBeVisible();
      await page.getByRole("button", { name: "Show more" }).click();
      await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();
      await page.getByRole("tab", { name: /Technologies/ }).click();
      await expect(page.getByText("Stripe").first()).toBeVisible();
      await page.getByRole("tab", { name: "News" }).click();
      await expect(page.getByText(/needs a data provider/).first()).toBeVisible();
      await page.getByRole("tab", { name: "Locations" }).click();
      await expect(page.getByText("Headquarters")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("company-page", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("bulk add to list and export for companies", async ({ browser }) => {
    const tag = uid();
    await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto(`/dashboard/companies?company=${encodeURIComponent(`Coparity ${tag}`)}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("checkbox", { name: "Select all companies on this page" }).click();
      const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
      await expect(bulk.getByRole("button", { name: /Clear 3 selected/ })).toBeVisible();
      const download = page.waitForEvent("download");
      await bulk.getByRole("button", { name: "Export to CSV" }).click();
      expect((await download).suggestedFilename()).toMatch(/^companies-.*\.csv$/);
      await bulk.getByRole("button", { name: "Add to list" }).click();
      const dialog = page.getByRole("dialog", { name: "Add to list" });
      const createNew = dialog.getByRole("button", { name: "Create a new list" });
      await expect(createNew.or(dialog.getByLabel("New list name"))).toBeVisible();
      if (await createNew.isVisible()) await createNew.click();
      await dialog.getByLabel("New list name").fill(`Coparity list ${tag}`);
      await dialog.getByRole("button", { name: "Add to list" }).click();
      await expect(page.getByText(new RegExp(`Added 3 companies to Coparity list ${tag}`))).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees companies read-only", async ({ browser }) => {
    const tag = uid();
    const [small] = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.viewer);
    try {
      await page.goto(`/dashboard/companies?company=${encodeURIComponent(`Coparity ${tag}`)}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("link", { name: small.name, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: `Save ${small.name}` })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Select ${small.name}` })).toHaveCount(0);
      await page.getByRole("link", { name: small.name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: small.name })).toBeVisible();
      for (const name of ["Save company", "Add to list", "Edit", "Delete"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
