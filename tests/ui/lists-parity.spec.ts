import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 150_000 });

const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (name: string, project: string) => `.playwright-mcp/wp-b/${name}-${project}.png`;

test.describe("lists (Apollo parity)", () => {
  test("new list drawer, empty list page with action cards, add people", async ({ browser }, info) => {
    const tag = uid();
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/lists"))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1, name: "My lists" })).toBeVisible();
      await expect(page.getByRole("tab", { name: /People lists/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("lists", info.project.name) });

      await page.getByRole("button", { name: "Create list" }).click();
      const sheet = page.getByRole("dialog", { name: "New list" });
      await sheet.getByLabel("List name").fill(`Parity static ${tag}`);
      await expect(sheet.getByLabel("List target")).toHaveValue("contact");
      await sheet.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/\/dashboard\/lists\/[0-9a-f-]+/);
      await expect(page.getByRole("heading", { level: 1, name: `Parity static ${tag}` })).toBeVisible();
      await expect(page.getByText("No records")).toBeVisible();
      await expect(page.getByRole("link", { name: /Find people/ })).toHaveAttribute("href", "/dashboard/people");
      await expect(page.getByRole("link", { name: /Import by CSV/ })).toHaveAttribute(
        "href",
        /import\?type=contacts&listId=/,
      );
      await expect(page.getByRole("link", { name: /Create workflow/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("list-empty", info.project.name) });

      // Add a person with the picker; the list page then shows the search table.
      await page.getByRole("button", { name: "Add people" }).click();
      const picker = page.getByRole("dialog", { name: "Add people" });
      await expect(picker.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible();
      await picker.getByRole("listitem").first().getByRole("checkbox").click();
      await picker.getByRole("button", { name: /Add 1 record/ }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByText(/^1 record/)).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a dynamic company list from filters", async ({ browser }) => {
    const tag = uid();
    const owner = await api(ACME.owner);
    const co = await owner.post("/api/v1/accounts", {
      data: { name: `Dyn ${tag}`, domain: `dyn-${tag}.example`, industry: `Dynindustry${tag}` },
    });
    expect(co.status()).toBe(201);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto("/dashboard/lists?type=company");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Create list" }).click();
      const sheet = page.getByRole("dialog", { name: "New list" });
      await sheet.getByLabel("List name").fill(`Parity dynamic ${tag}`);
      await expect(sheet.getByLabel("List target")).toHaveValue("company");
      await sheet.getByRole("button", { name: "Select filters" }).click();
      const modal = page.getByRole("dialog", { name: "Filters" });
      await modal.getByRole("button", { name: "Industry & keywords", exact: true }).click();
      await modal.getByLabel("Industries", { exact: true }).fill(`Dynindustry${tag}`);
      await modal.getByRole("button", { name: "Add industries" }).click();
      await expect(modal.getByTestId("filters-modal-count")).toContainText("1 record found");
      await modal.getByRole("button", { name: "Apply filters" }).click();
      await expect(sheet.getByTestId("new-list-filters")).toContainText(`Dynindustry${tag}`);
      await sheet.getByRole("button", { name: "Create" }).click();
      await expect(page.getByRole("heading", { level: 1, name: `Parity dynamic ${tag}` })).toBeVisible();
      await expect(page.getByText("Dynamic", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `Dyn ${tag}`, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit filters" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees lists read-only, in dark mode", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      expect((await page.goto("/dashboard/lists"))?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("button", { name: "Create list" })).toHaveCount(0);
      const first = page.getByRole("table").getByRole("link").first();
      const name = (await first.textContent()) ?? "";
      await first.click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      for (const label of ["Add people", "Rename", "Delete", "Edit filters"]) {
        await expect(page.getByRole("button", { name: label })).toHaveCount(0);
      }
      await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
