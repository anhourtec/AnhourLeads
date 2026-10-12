import { type Browser, expect, test } from "@playwright/test";

import { q } from "../support/discovery-fixtures";
import { ACME, apiAs, BASE_URL, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";
import { expectNoHorizontalOverflow, setDarkMode, signedInPage } from "./white-label-ui";

/** Platform → Data pipeline (/dashboard/platform/data): platform administrators only. */

const shot = (name: string, project: string) => `.playwright-mcp/wp-f/platform-data-${project}-${name}.png`;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe("platform data pipeline screen", () => {
  test("the platform administrator manages sources and opt-outs across every tab", async ({ browser }, info) => {
    test.setTimeout(120_000);
    const id = uid();
    const sourceName = `WP-F UI ${id}`;
    const optoutDomain = `ui-${id}.disco.test`;
    const admin = await apiAs(PLATFORM_ADMIN);
    const created = await admin.post("/api/v1/platform/seed_sources", {
      data: { kind: "manual", name: sourceName, text: `ui-seed-${id}.disco.test` },
    });
    expect(created.status()).toBe(201);
    const sourceId = (await created.json()).seed_source.id as string;

    const { context, page, errors } = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      expect((await page.goto("/dashboard/platform"))?.status()).toBe(200);
      await page.getByRole("link", { name: "Data pipeline" }).click();
      await expect(page).toHaveURL(/\/dashboard\/platform\/data$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Data pipeline" })).toBeVisible();
      await expect(page.getByText("Crawl throughput")).toBeVisible();
      await expect(page.getByText("Workers", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("overview", info.project.name), fullPage: true });

      // Seed sources: enable and run.
      await page.getByRole("tab", { name: "Seed sources" }).click();
      await expect(page).toHaveURL(/tab=sources/);
      const card = page.getByTestId("seed-source").filter({ hasText: sourceName });
      await expect(card).toBeVisible();
      await card.getByLabel(`Enable ${sourceName}`).click();
      await expect(page.getByText(`${sourceName} enabled.`)).toBeVisible();
      await card.getByRole("button", { name: "Run now" }).click();
      await expect(page.getByText(new RegExp(`${sourceName} ran:`))).toBeVisible();
      await expect(card.getByText(/1 queued|1 re-queued|0 queued/)).toBeVisible();
      await card.getByRole("button", { name: "Configure" }).click();
      await expect(page.getByRole("dialog", { name: `Configure ${sourceName}` })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("source-dialog", info.project.name) });
      await page.getByRole("button", { name: "Cancel" }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sources", info.project.name), fullPage: true });

      // Crawl queue: the seeded homepage is listed.
      await page.getByRole("tab", { name: "Crawl queue" }).click();
      await page.getByLabel("Search URLs").fill(`ui-seed-${id}`);
      await page.getByLabel("Search URLs").press("Enter");
      await expect(page.getByTestId("frontier-row").filter({ hasText: `ui-seed-${id}.disco.test` })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("queue", info.project.name), fullPage: true });

      // Hosts.
      await page.getByRole("tab", { name: "Hosts" }).click();
      await page.getByLabel("Search hosts").fill(`ui-seed-${id}`);
      await page.getByLabel("Search hosts").press("Enter");
      const host = page.getByTestId("host-row").filter({ hasText: `ui-seed-${id}.disco.test` });
      await expect(host).toBeVisible();
      await host.getByRole("button", { name: /^Block/ }).click();
      await expect(page.getByText(`ui-seed-${id}.disco.test is blocked.`)).toBeVisible();
      await expect(host.getByText("Blocked", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("hosts", info.project.name), fullPage: true });

      // Opt-outs: add one.
      await page.getByRole("tab", { name: "Opt-outs" }).click();
      await page.getByLabel("Domain", { exact: true }).fill(optoutDomain);
      await page.getByRole("button", { name: "Add opt-out" }).click();
      await expect(page.getByText(/Opt-out added/)).toBeVisible();
      await expect(page.getByTestId("optout-row").filter({ hasText: optoutDomain })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("optouts", info.project.name), fullPage: true });

      // Settings.
      await page.getByRole("tab", { name: "Settings" }).click();
      await expect(page.getByLabel("Delete people not seen for (days)")).toHaveValue(/^\d+$/);
      await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("settings", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await admin.patch(`/api/v1/platform/seed_sources/${sourceId}`, { data: { enabled: false } });
      await admin.post(`/api/v1/platform/crawler/hosts/ui-seed-${id}.disco.test/unblock`);
      const list = await (await admin.get(`/api/v1/platform/optouts?q=${optoutDomain}`)).json();
      for (const o of list.optouts as Array<{ id: string }>) await admin.delete(`/api/v1/platform/optouts/${o.id}`);
    }

    const dark = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      await setDarkMode(dark.context, BASE_URL);
      await dark.page.goto("/dashboard/platform/data?tab=sources");
      await expect(dark.page.locator("html")).toHaveClass(/dark/);
      await expect(dark.page.getByRole("tab", { name: "Seed sources", selected: true })).toBeVisible();
      await expectNoHorizontalOverflow(dark.page);
      await dark.page.screenshot({ path: shot("sources-dark", info.project.name), fullPage: true });
      await dark.page.goto("/dashboard/platform/data");
      await expectNoHorizontalOverflow(dark.page);
      await dark.page.screenshot({ path: shot("overview-dark", info.project.name), fullPage: true });
      expect(dark.errors).toEqual([]);
    } finally {
      await dark.context.close();
    }
  });

  test("registry sources show their licence, what the environment lacks and their totals", async ({
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const id = uid();
    const admin = await apiAs(PLATFORM_ADMIN);
    const chName = `Registry UI CH ${id}`;
    const secName = `Registry UI SEC ${id}`;
    const ids: string[] = [];
    for (const [kind, name] of [
      ["companies_house", chName],
      ["sec_edgar", secName],
    ]) {
      const res = await admin.post("/api/v1/platform/seed_sources", { data: { kind, name } });
      expect(res.status()).toBe(201);
      ids.push((await res.json()).seed_source.id as string);
    }
    const stats = {
      fetched: 300,
      companiesAdded: 12,
      companiesMatched: 3,
      skippedNoWebsite: 285,
      peopleAdded: 41,
      errors: [],
      cursor: 300,
      candidates: 10_000,
      reachedEnd: false,
      totals: { companiesAdded: 12, companiesMatched: 3, skippedNoWebsite: 285, peopleAdded: 41 },
    };
    await q("update seed_source set stats = $1::jsonb, last_run_at = now() where id = $2", [
      JSON.stringify(stats),
      ids[1],
    ]);

    try {
      await checkRegistryCards(browser, info.project.name, chName, secName);
    } finally {
      await q("delete from seed_source where id = any($1)", [ids]);
    }
  });

  async function checkRegistryCards(browser: Browser, project: string, chName: string, secName: string) {
    const { context, page, errors } = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      await page.goto("/dashboard/platform/data?tab=sources");
      const ch = page.getByTestId("seed-source").filter({ hasText: chName });
      const sec = page.getByTestId("seed-source").filter({ hasText: secName });
      await expect(ch).toBeVisible();
      await expect(ch.getByText("Licence: Open Government Licence v3.0")).toBeVisible();
      await expect(sec.getByText("Licence: Public domain (US government work)")).toBeVisible();
      if (!process.env.COMPANIES_HOUSE_API_KEY) {
        await expect(ch.getByTestId("source-requirement")).toContainText("API key missing");
        await expect(ch.getByTestId("source-requirement")).toContainText("COMPANIES_HOUSE_API_KEY");
        await expect(ch.getByRole("button", { name: "Run now" })).toBeDisabled();
      }
      if (!process.env.SEC_USER_AGENT) {
        await expect(sec.getByTestId("source-requirement")).toContainText("SEC_USER_AGENT");
      } else {
        await expect(sec.getByTestId("source-requirement")).toHaveCount(0);
      }
      await expect(
        sec.getByText(/12 companies added · 3 matched · 285 skipped without a website · 41 people added/).first(),
      ).toBeVisible();
      await expect(sec.getByTestId("source-totals")).toContainText("next run starts at 300 of 10,000");
      await ch.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await ch.screenshot({ path: shot("registry-ch", project) });
      await sec.screenshot({ path: shot("registry-sec", project) });
      await sec.getByRole("button", { name: "Configure" }).click();
      const dialog = page.getByRole("dialog", { name: `Configure ${secName}` });
      await expect(dialog.getByLabel("Configuration (JSON)")).toHaveValue(/formLookbackDays/);
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "Cancel" }).click();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }

    const dark = await signedInPage(browser, PLATFORM_ADMIN);
    try {
      await setDarkMode(dark.context, BASE_URL);
      await dark.page.goto("/dashboard/platform/data?tab=sources");
      const ch = dark.page.getByTestId("seed-source").filter({ hasText: chName });
      await expect(ch).toBeVisible();
      await ch.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(dark.page);
      await ch.screenshot({ path: shot("registry-ch-dark", project) });
      expect(dark.errors).toEqual([]);
    } finally {
      await dark.context.close();
    }
  }

  for (const email of [ACME.owner, ACME.member, GLOBEX_OWNER]) {
    test(`${email} gets the not-found page`, async ({ browser }) => {
      const { context, page } = await signedInPage(browser, email);
      try {
        expect((await page.goto("/dashboard/platform/data"))?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});
