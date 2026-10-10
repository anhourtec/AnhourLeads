import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, closeFilters, expectNoHorizontalOverflow, openAs, openFilters, shot, uid } from "./records-ui";

test.describe.configure({ timeout: 90_000 });

// The dev server compiles routes on first visit; give navigations room.
const expect = baseExpect.configure({ timeout: 15_000 });

/** A company imported from CSV with two people. */
async function importCompany(tag: string) {
  const owner = await api(ACME.owner);
  const csv = `Name,Domain,Industry,Employees,Country,Technologies\nOrbital ${tag},orbital-${tag}.example,Aerospace ${tag},640,Canada,React;Go\n`;
  expect((await owner.post("/api/v1/accounts/import", { data: { csv } })).status()).toBe(200);
  const found = await (await owner.post("/api/v1/accounts/search", { data: { q: `orbital-${tag}` } })).json();
  const company = found.accounts[0] as { id: string; name: string };
  for (const first of ["Ana", "Ben"]) {
    const res = await owner.post("/api/v1/contacts", {
      data: {
        firstName: first,
        lastName: tag,
        email: `${first.toLowerCase()}@orbital-${tag}.example`,
        companyId: company.id,
      },
    });
    expect(res.status()).toBe(201);
  }
  return company;
}

test.describe("companies screen", () => {
  test("member filters companies and opens one with its people and provenance", async ({ browser }, info) => {
    const tag = uid();
    const company = await importCompany(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/companies");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add company" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Export" })).toHaveAttribute("href", /\/api\/v1\/accounts\/export/);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("searchbox", { name: "Search companies" }).fill(`orbital-${tag}`);
      await expect(page).toHaveURL(/q=orbital-/);
      await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
      await expect(page.getByRole("link", { name: company.name })).toBeVisible();

      const filters = await openFilters(page);
      await filters.getByRole("textbox", { name: "Employees, minimum" }).fill("1000");
      await filters.getByRole("textbox", { name: "Employees, minimum" }).press("Enter");
      await expect(page).toHaveURL(/employeesMin=1000/);
      await closeFilters(page);
      await expect(page.getByText("No companies match these filters")).toBeVisible();
      await page.goto(`/dashboard/companies?q=orbital-${tag}&employeesMin=500&industry=aerospace%20${tag}`);
      await expect(page.getByRole("link", { name: company.name })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("companies-list", info.project.name), fullPage: true, caret: "initial" });

      await page.getByRole("link", { name: company.name }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/companies/${company.id}`));
      await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
      await expect(page.getByTestId("provenance").first()).toContainText(/csv_import · .*ago · 90%/);
      await expect(page.getByText("640")).toBeVisible();
      await expect(page.getByRole("link", { name: `Ana ${tag}` })).toBeVisible();
      await expect(page.getByRole("link", { name: `Ben ${tag}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("company-detail", info.project.name), fullPage: true, caret: "initial" });

      // Edit sends only what changed, recorded as a manual edit.
      await page.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: /^Edit/ });
      await edit.getByLabel("Industry").fill(`Space ${tag}`);
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit).toBeHidden();
      await expect(page.getByText(`Space ${tag}`)).toBeVisible();

      // Add a person from the company page: the company is preselected.
      await page.getByRole("button", { name: "Add person" }).click();
      const add = page.getByRole("dialog", { name: "Add person" });
      await expect(add.getByLabel("Company")).toHaveValue(company.id);
      await add.getByLabel("First name").fill("Cleo");
      await add.getByLabel("Last name").fill(tag);
      await add.getByRole("button", { name: "Add person" }).click();
      await expect(add).toBeHidden();
      await expect(page.getByRole("link", { name: `Cleo ${tag}` })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("member adds a company and sees validation", async ({ browser }) => {
    const tag = uid();
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto("/dashboard/companies");
      await page.getByRole("button", { name: "Add company" }).click();
      const dialog = page.getByRole("dialog", { name: "Add company" });
      await dialog.getByRole("button", { name: "Add company" }).click();
      await expect(dialog.getByText("Give the company a name.")).toBeVisible();
      await dialog.getByLabel("Name").fill(`Dialog Co ${tag}`);
      await dialog.getByLabel("Domain").fill("not a domain");
      await dialog.getByRole("button", { name: "Add company" }).click();
      await expect(dialog.getByText("Enter a domain like example.com.")).toBeVisible();
      await dialog.getByLabel("Domain").fill(`https://www.dialog-${tag}.example`);
      await dialog.getByLabel("Employees").fill("1,250");
      await dialog.getByRole("button", { name: "Add company" }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole("searchbox", { name: "Search companies" }).fill(`dialog-${tag}`);
      await expect(page).toHaveURL(/q=dialog-/);
      await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
      await expect(page.getByText(`dialog-${tag}.example`)).toBeVisible();
      await expect(page.getByRole("table").getByText("1,250")).toBeVisible();

      // A second company with the same domain is refused with a plain message.
      await page.getByRole("button", { name: "Add company" }).click();
      await dialog.getByLabel("Name").fill("Duplicate");
      await dialog.getByLabel("Domain").fill(`dialog-${tag}.example`);
      await dialog.getByRole("button", { name: "Add company" }).click();
      await expect(dialog.getByText("Another company in this workspace already has this domain.")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Import CSV" }).click();
      const importer = page.getByRole("dialog", { name: "Import companies from CSV" });
      await expect(importer.getByLabel("CSV file")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      // The browser logs the deliberate 409 above as a failed resource; nothing else may appear.
      expect(errors.filter((e) => !e.includes("status of 409"))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("manager bulk-updates and deletes companies", async ({ browser }) => {
    const tag = uid();
    const company = await importCompany(tag);
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await page.goto(`/dashboard/companies?q=orbital-${tag}`);
      await page.getByRole("checkbox", { name: `Select ${company.name}` }).click();
      const bulk = page.getByRole("group", { name: "Bulk actions" });
      await bulk.getByLabel("Change stage").selectOption("customer");
      await expect(page.getByText(/Moved 1 company to Customer/)).toBeVisible();
      await expect(page.getByRole("table").getByText("Customer")).toBeVisible();

      await page.getByRole("link", { name: company.name }).click();
      await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
      await page.getByRole("button", { name: "Delete" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Its 2 people stay in the workspace");
      await confirm.getByRole("button", { name: "Delete" }).click();
      await expect(page).toHaveURL(/\/dashboard\/companies$/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees no write controls; dark mode has no overflow", async ({ browser }, info) => {
    const tag = uid();
    const company = await importCompany(tag);
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await page.goto(`/dashboard/companies?q=orbital-${tag}`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("link", { name: company.name })).toBeVisible();
      for (const name of ["Add company", "Import CSV"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Export" })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Select ${company.name}` })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("companies-dark", info.project.name), fullPage: true, caret: "initial" });
      await page.getByRole("link", { name: company.name }).click();
      await expect(page.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
      for (const name of ["Edit", "Delete", "Add person"])
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("company-dark", info.project.name), fullPage: true, caret: "initial" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
