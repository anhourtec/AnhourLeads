import { expect, test } from "@playwright/test";

import { ACME, apiAs, BASE_URL } from "../support/session";
import { expectNoHorizontalOverflow, setDarkMode, shot, signedInPage } from "./white-label-ui";

const RUN = Date.now().toString(36);

/** Remove hostnames a failed run left behind (API, as the owner). */
async function cleanup(prefix: string): Promise<void> {
  const owner = await apiAs(ACME.owner);
  const { domains } = (await (await owner.get("/api/v1/domains")).json()) as {
    domains: { id: string; hostname: string }[];
  };
  for (const d of domains.filter((x) => x.hostname.startsWith(prefix))) {
    await owner.delete(`/api/v1/domains/${d.id}`);
  }
}

test.describe("domains screen", () => {
  test("an owner adds, sees and removes a local hostname", async ({ browser }, info) => {
    const prefix = `wlui-${info.project.name}-`;
    await cleanup(prefix);
    const hostname = `${prefix}${RUN}.localhost:3410`;
    const { context, page, errors } = await signedInPage(browser, ACME.owner);
    try {
      expect((await page.goto("/dashboard/settings/domains"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Domains" })).toBeVisible();
      await expect(page.getByTestId("hostname-usage")).toContainText(/of 3 hostnames used/);
      const seeded = page.getByTestId("domain-card").filter({ hasText: "acme.localhost:3410" });
      await expect(seeded).toBeVisible();
      await expect(seeded.getByText("Verified", { exact: true })).toBeVisible();
      await expect(seeded.getByText(/Local development — no certificate/)).toBeVisible();

      // Validation message from the API, shown inline.
      await page.getByLabel("Add hostname").fill("portal.example.com.");
      await page.getByRole("button", { name: "Add hostname" }).click();
      await expect(page.getByText("Remove the trailing dot from the hostname.")).toBeVisible();

      await page.getByLabel("Add hostname").fill(hostname);
      await page.getByRole("button", { name: "Add hostname" }).click();
      const card = page.getByTestId("domain-card").filter({ hasText: hostname });
      await expect(card).toBeVisible();
      await expect(card.getByText("Verified", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("domains-owner", info.project.name), fullPage: true, caret: "initial" });

      await card.getByRole("button", { name: `Remove ${hostname}` }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText(`Remove ${hostname}?`)).toBeVisible();
      await dialog.getByRole("button", { name: "Remove hostname" }).click();
      await expect(card).toHaveCount(0);
      // The browser logs the deliberate 422 above as a failed resource; nothing else is allowed.
      expect(errors.filter((e) => !e.includes("status of 422"))).toEqual([]);
    } finally {
      await context.close();
      await cleanup(prefix);
    }
  });

  test("a pending hostname shows its DNS records, steps and the verify result", async ({ browser }, info) => {
    test.skip(info.project.name !== "ui-desktop", "One pending hostname at a time: the workspace allows 3.");
    const prefix = "wlui-pending-";
    await cleanup(prefix);
    const hostname = `${prefix}${RUN}.example.invalid`;
    const owner = await apiAs(ACME.owner);
    const created = await owner.post("/api/v1/domains", { data: { hostname } });
    expect(created.status()).toBe(201);
    const { context, page, errors } = await signedInPage(browser, ACME.owner);
    try {
      await setDarkMode(context, BASE_URL);
      await page.goto("/dashboard/settings/domains");
      const card = page.getByTestId("domain-card").filter({ hasText: hostname });
      await expect(card.getByText("Pending", { exact: true })).toBeVisible();
      await expect(card.getByRole("region", { name: `Set up DNS for ${hostname}` })).toBeVisible();
      await expect(card.getByText(`_anhour-verify.${hostname}`)).toBeVisible();
      await expect(card.getByRole("button", { name: "Copy TXT value" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Copy CNAME name" })).toBeVisible();
      await expect(card.getByRole("list", { name: "Set-up progress" }).getByRole("listitem")).toHaveCount(4);

      await card.getByRole("button", { name: "Verify now" }).click();
      await expect(
        card.getByText(`No TXT record found at _anhour-verify.${hostname} yet.`, { exact: false }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: shot("domains-pending-dark", info.project.name),
        fullPage: true,
        caret: "initial",
      });
      // The toast repeats the message; the card keeps it.
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await cleanup(prefix);
    }
  });

  test("a manager sees hostnames read-only", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.manager);
    try {
      expect((await page.goto("/dashboard/settings/domains"))?.status()).toBe(200);
      await expect(page.getByTestId("domain-card").filter({ hasText: "acme.localhost:3410" })).toBeVisible();
      await expect(page.getByText("Administrators add and verify them.")).toBeVisible();
      await expect(page.getByLabel("Add hostname")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Remove|Verify now/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("domains-manager", info.project.name), fullPage: true, caret: "initial" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const role of ["member", "viewer"] as const) {
    test(`a ${role} gets the not-found page`, async ({ browser }) => {
      const { context, page } = await signedInPage(browser, ACME[role]);
      try {
        expect((await page.goto("/dashboard/settings/domains"))?.status()).toBe(404);
        await expect(page.getByText("Page not found.")).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});
