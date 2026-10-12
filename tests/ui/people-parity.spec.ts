import { expect as baseExpect, type Page, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 150_000 });

// The shared dev server compiles routes on first visit; give it room.
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (name: string, project: string) => `.playwright-mcp/wp-b/${name}-${project}.png`;

/** A company with three people, all tagged with `tag` in the company name. */
async function seed(tag: string) {
  const owner = await api(ACME.owner);
  const co = await owner.post("/api/v1/accounts", {
    data: { name: `Parity ${tag}`, domain: `parity-${tag}.example`, industry: "Software", employeeCount: 120 },
  });
  expect(co.status(), await co.text()).toBe(201);
  const company = (await co.json()).account as { id: string; name: string };
  const people: { id: string; name: string }[] = [];
  for (const [first, title, country] of [
    ["Vera", "VP of Sales", "Canada"],
    ["Hugo", "Head of Marketing", "Germany"],
    ["Ines", "Sales Manager", "Canada"],
  ] as const) {
    const res = await owner.post("/api/v1/contacts", {
      data: {
        firstName: first,
        lastName: `Parity${tag}`,
        email: `${first.toLowerCase()}-${tag}@parity-${tag}.example`,
        title,
        country,
        companyId: company.id,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const c = (await res.json()).contact as { id: string; name: string };
    people.push({ id: c.id, name: c.name });
  }
  return { company, people };
}

async function openRail(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1024) return page.getByRole("complementary", { name: "Filters" });
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeRail(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 1024) await page.keyboard.press("Escape");
}

test.describe("find people (Apollo parity)", () => {
  test("empty state, natural-language search, rail, chips, modal and quick filters", async ({ browser }, info) => {
    const tag = uid();
    await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/people"))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1, name: "Find people" })).toBeVisible();
      await expect(page.getByLabel("Describe who you're looking for")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Quick filters" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-empty", info.project.name) });

      // Natural language → filters.
      await page.getByLabel("Describe who you're looking for").fill(`VP sales in Canada at Parity ${tag}`);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page).toHaveURL(/titles=VP\+sales/);
      await expect(page).toHaveURL(/location=Canada/);

      // Total searches the shared database; the workspace's own people are on Saved.
      const rail = await openRail(page);
      await expect(rail.getByRole("radio", { name: /Total/ })).toBeChecked();
      await rail.locator("label", { hasText: "Saved" }).click();
      await expect(page).toHaveURL(/segment=saved/);
      await expect(rail.getByRole("radio", { name: /Saved/ })).toBeChecked();
      await closeRail(page);
      await expect(page.getByRole("link", { name: `Vera Parity${tag}`, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `Ines Parity${tag}`, exact: true })).toHaveCount(0);

      // Chips in the rail, removable one by one.
      await openRail(page);
      await expect(rail.getByRole("button", { name: "Remove Include titles VP sales" })).toBeVisible();
      await rail.getByRole("button", { name: "Remove Include titles VP sales" }).click();
      await expect(page).not.toHaveURL(/titles=/);
      await closeRail(page);
      await expect(page.getByRole("link", { name: `Ines Parity${tag}`, exact: true })).toBeVisible();

      // Filters modal: live count, then apply an email status filter.
      const rail2 = await openRail(page);
      await rail2.getByRole("button", { name: "View all filters" }).click();
      const modal = page.getByRole("dialog", { name: "Filters" });
      await expect(modal.getByTestId("filters-modal-count")).toContainText("records found");
      await expect(modal.getByRole("button", { name: "Buying intent (needs a data provider)" })).toBeVisible();
      await modal.getByRole("button", { name: "Stage", exact: true }).click();
      await modal.getByRole("checkbox", { name: /^Cold/ }).click();
      await modal.getByRole("button", { name: "Apply filters" }).click();
      await expect(page).toHaveURL(/stage=new/);
      await expect(page.getByRole("link", { name: `Vera Parity${tag}`, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-results", info.project.name) });

      // Clear all, then a quick filter chip.
      await page.goto("/dashboard/people");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Canada" }).first().click();
      await expect(page).toHaveURL(/location=Canada/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("select popover, bulk bar, add to list, columns and company drawer", async ({ browser }, info) => {
    const tag = uid();
    const { company } = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto(`/dashboard/people?company=${encodeURIComponent(company.name)}&segment=saved`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Job title" })).toBeVisible();

      // Select this page through the popover.
      await page.getByRole("button", { name: "Selection options" }).click();
      await page.getByRole("radio", { name: /Select this page/ }).check();
      await page.getByRole("button", { name: "Apply" }).click();
      const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
      await expect(bulk.getByRole("button", { name: /Clear 3 selected/ })).toBeVisible();
      await expect(bulk.getByRole("button", { name: "Save" })).toBeVisible();

      // Add to a new list, inline.
      await bulk.getByRole("button", { name: "Add to list" }).click();
      const dialog = page.getByRole("dialog", { name: "Add to list" });
      const createNew = dialog.getByRole("button", { name: "Create a new list" });
      await expect(createNew.or(dialog.getByLabel("New list name"))).toBeVisible();
      if (await createNew.isVisible()) await createNew.click();
      await dialog.getByLabel("New list name").fill(`Parity list ${tag}`);
      await dialog.getByRole("button", { name: "Add to list" }).click();
      await expect(page.getByText(new RegExp(`Added 3 people to Parity list ${tag}`))).toBeVisible();

      // Save (assign to me).
      await bulk.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(/Saved 3 people to you/)).toBeVisible();
      await bulk.getByRole("button", { name: /Clear 3 selected/ }).click();
      await expect(bulk).toHaveCount(0);

      // Add a column.
      await page.getByRole("button", { name: "Add column" }).click();
      await page.getByRole("checkbox", { name: "Stage" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("columnheader", { name: "Stage" })).toBeVisible();

      // Company drawer.
      await page.getByRole("button", { name: company.name, exact: true }).first().click();
      const drawer = page.getByRole("dialog", { name: `Company: ${company.name}` });
      await expect(drawer.getByRole("heading", { name: company.name, exact: true })).toBeVisible({ timeout: 45_000 });
      await expect(drawer.getByText("Company details", { exact: true })).toBeVisible();
      await drawer.getByRole("tab", { name: /People/ }).click();
      await expect(drawer.getByRole("link", { name: `Vera Parity${tag}`, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-drawer", info.project.name) });
      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toBeHidden();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("saved searches, sort and search settings", async ({ browser }) => {
    const tag = uid();
    const { company } = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto(`/dashboard/people?company=${encodeURIComponent(company.name)}&segment=saved`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Save as new search" }).click();
      const save = page.getByRole("dialog", { name: "Save as new search" });
      await save.getByLabel("Name").fill(`Parity search ${tag}`);
      await save.getByLabel("Share with everyone in the workspace").check();
      await save.getByRole("button", { name: "Save search" }).click();
      await expect(page).toHaveURL(/savedSearchId=/);
      await expect(page.getByRole("button", { name: `Parity search ${tag}` })).toBeVisible();

      // Back to the default view, then pick the saved search from the menu.
      await page.getByRole("button", { name: `Parity search ${tag}` }).click();
      await page.getByRole("list", { name: "Saved searches" }).getByRole("button", { name: "Default view" }).click();
      await expect(page).not.toHaveURL(/company=/);
      await page.locator('button[aria-haspopup="dialog"]', { hasText: "Default view" }).click();
      await page.getByRole("tab", { name: "Your searches" }).click();
      await page.getByRole("button", { name: new RegExp(`^Parity search ${tag}`) }).click();
      await expect(page).toHaveURL(/company=Parity/);
      await expect(page.getByRole("link", { name: `Vera Parity${tag}`, exact: true })).toBeVisible();

      // Sort by name ascending.
      await page.getByRole("button", { name: /^Sort:/ }).click();
      await page.getByLabel("Sort by").selectOption("name");
      await page.getByRole("radio", { name: "Ascending" }).check();
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/sortBy=name/);

      // 50 per page.
      await page.getByRole("button", { name: "Search settings" }).click();
      await page.getByLabel("Results per page").selectOption("50");
      await expect(page).toHaveURL(/per_page=50/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("single contact from the Import menu; manager bulk stage and delete", async ({ browser }) => {
    const tag = uid();
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await page.goto("/dashboard/people");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Import" }).click();
      await expect(page.getByRole("menuitem", { name: "CSV file" })).toHaveAttribute("href", /import\?type=contacts/);
      await page.getByRole("menuitem", { name: "Single contact" }).click();
      const dialog = page.getByRole("dialog", { name: "Add person" });
      await dialog.getByLabel("First name").fill("Menu");
      await dialog.getByLabel("Last name").fill(`Added${tag}`);
      await dialog.getByLabel("Email").fill(`menu-${tag}@parity.example`);
      await dialog.getByRole("button", { name: "Add person" }).click();
      await expect(dialog).toBeHidden();

      await page.goto(`/dashboard/people?q=menu-${tag}&segment=saved`);

      await page.waitForLoadState("networkidle");
      await page.getByRole("checkbox", { name: `Select Menu Added${tag}` }).click();
      const bulk = page.getByRole("toolbar", { name: "Bulk actions" });
      await bulk.getByRole("button", { name: "More bulk actions" }).click();
      await page.getByRole("menuitem", { name: "Update stage" }).click();
      await page.getByRole("menuitem", { name: "Interested", exact: true }).click();
      await expect(page.getByText(/Moved 1 person to Interested/)).toBeVisible();

      await bulk.getByRole("button", { name: "More bulk actions" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Deleted 1 person.")).toBeVisible();
      await expect(page.getByText("No people match these filters")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees results but no write or bulk controls; dark mode", async ({ browser }, info) => {
    const tag = uid();
    const { company, people } = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await page.goto(`/dashboard/people?company=${encodeURIComponent(company.name)}&segment=saved`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("link", { name: people[0].name, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save as new search" })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Select ${people[0].name}` })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Add ${people[0].name} to a list` })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Access email" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-viewer-dark", info.project.name) });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("saved people is the search fixed to records you own", async ({ browser }) => {
    const tag = uid();
    const { company } = await seed(tag);
    const { context, page, errors } = await openAs(browser, ACME.owner);
    try {
      await page.goto(`/dashboard/saved/people?company=${encodeURIComponent(company.name)}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1, name: "Saved people" })).toBeVisible();
      const rail = await openRail(page);
      await expect(rail.getByRole("radio", { name: /Saved/ })).toBeChecked();
      await expect(rail.getByRole("radio", { name: /Total/ })).toBeDisabled();
      await closeRail(page);
      // The owner created these people, so they own them.
      await expect(page.getByRole("link", { name: `Vera Parity${tag}`, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
