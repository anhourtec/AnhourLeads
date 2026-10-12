import { expect, type Locator, test } from "@playwright/test";

import { expectNoHorizontalOverflow, openAs, shot } from "../ui/records-ui";

/**
 * Find people / Find companies on an installation whose discovery index is empty (the isolated
 * database is seeded with `--reset-index`). Platform administrators are pointed at the data sources;
 * everyone else is told to ask their administrator. Both can fall back to their saved records.
 */
const PLATFORM_ADMIN = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? "admin@anhourleads.local";

/** The empty card sits inside its panel (a margin on a full-width box would push it past the edge). */
async function expectInsideParent(locator: Locator): Promise<void> {
  const [box, parent] = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = (el.parentElement as HTMLElement).getBoundingClientRect();
    return [
      { left: r.left, right: r.right },
      { left: p.left, right: p.right },
    ];
  });
  expect(box.left).toBeGreaterThanOrEqual(parent.left);
  expect(box.right).toBeLessThanOrEqual(parent.right);
}

const PAGES = [
  { path: "/dashboard/people", noun: "people" },
  { path: "/dashboard/companies", noun: "companies" },
] as const;

test.describe("empty discovery index", () => {
  for (const { path, noun } of PAGES) {
    test(`${noun}: opens on Saved, and Total explains the empty shared database to a workspace owner`, async ({
      browser,
    }, info) => {
      const { context, page, errors } = await openAs(browser, "owner@acme.test");
      await page.goto(path);
      // With nothing in the index the page opens on the workspace's own records.
      await expect(page).not.toHaveURL(/segment=total/);
      await expect(page.getByTestId("index-empty")).toHaveCount(0);

      await page.goto(`${path}?segment=total`);
      const empty = page.getByTestId("index-empty").filter({ visible: true });
      await expect(empty).toBeVisible();
      await expect(empty.getByText(`The shared database has no ${noun} yet`)).toBeVisible();
      await expect(empty.getByText("Ask your administrator to turn on data sources.")).toBeVisible();
      await expect(empty.getByRole("link", { name: "Manage data sources" })).toHaveCount(0);
      await expectInsideParent(empty);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: shot(`empty-index-${noun}-owner`, info.project.name),
        fullPage: true,
        caret: "initial",
      });

      await empty.getByRole("button", { name: `Show saved ${noun}` }).click();
      await expect(page).toHaveURL(/segment=saved/);
      await expect(page.getByTestId("index-empty")).toHaveCount(0);
      expect(errors).toEqual([]);
      await context.close();
    });

    test(`${noun}: a platform administrator is pointed at the data sources`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, PLATFORM_ADMIN, { dark: true });
      await page.goto(`${path}?segment=net_new`);
      const empty = page.getByTestId("index-empty").filter({ visible: true });
      await expect(empty).toBeVisible();
      await expect(empty.getByText("Add domains or turn on sources to start collecting.")).toBeVisible();
      await expectInsideParent(empty);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: shot(`empty-index-${noun}-platform-admin`, info.project.name),
        fullPage: true,
        caret: "initial",
      });

      await empty.getByRole("link", { name: "Manage data sources" }).click();
      await expect(page).toHaveURL(/\/dashboard\/platform\/data\?tab=sources/);
      await expect(page.getByRole("tab", { name: "Seed sources", selected: true })).toBeVisible();
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("a viewer sees the same explanation without the administrator link", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "viewer@acme.test");
    await page.goto("/dashboard/people?segment=total");
    const empty = page.getByTestId("index-empty").filter({ visible: true });
    await expect(empty.getByText("Ask your administrator to turn on data sources.")).toBeVisible();
    await expect(empty.getByRole("link", { name: "Manage data sources" })).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});
