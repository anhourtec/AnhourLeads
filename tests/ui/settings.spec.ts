import { expect as baseExpect, test } from "@playwright/test";

import { can, type Permission, ROLES } from "../../src/lib/rbac/permissions";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, shot, uid } from "./admin-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

const PAGES: { path: string; title: string; permission: Permission | null }[] = [
  { path: "/dashboard/settings/members", title: "Members", permission: "member:read" },
  { path: "/dashboard/settings/do-not-contact", title: "Do not contact", permission: "suppression:read" },
  { path: "/dashboard/settings/api-keys", title: "API keys", permission: "apikey:read" },
  { path: "/dashboard/settings/audit-log", title: "Audit log", permission: "audit:read" },
  { path: "/dashboard/account", title: "Account", permission: null },
];

test.describe("settings screens", () => {
  for (const role of ROLES) {
    test(`pages render or 404 for ${role}`, async ({ browser }) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "manager" });
      try {
        for (const p of PAGES) {
          const allowed = p.permission === null || can(role, p.permission);
          const before = errors.length;
          const res = await page.goto(p.path);
          expect(res?.status(), `${role} ${p.path}`).toBe(allowed ? 200 : 404);
          if (!allowed) {
            // The shared not-found page logs its own 404; only errors from our screens count.
            errors.splice(before);
            continue;
          }
          await expect(page.getByRole("heading", { level: 1, name: p.title })).toBeVisible();
          await expectNoHorizontalOverflow(page);
        }
        await page.goto("/dashboard/settings/members");
        const invite = page.getByRole("button", { name: "Invite member" });
        if (can(role, "member:invite")) await expect(invite).toBeVisible();
        else await expect(invite).toHaveCount(0);
        await page.goto("/dashboard/settings/do-not-contact");
        await expect(page.getByRole("button", { name: "Add entry" })).toHaveCount(
          can(role, "suppression:create") ? 1 : 0,
        );
        await expect(page.getByRole("button", { name: "Erase person" })).toHaveCount(
          can(role, "contact:delete") && can(role, "suppression:create") ? 1 : 0,
        );
        // The shared not-found page's own logs can arrive late; they aren't from these screens.
        const ours = errors.filter((e) => !/status of 404|Encountered a script tag/.test(e));
        expect(ours).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("an API key secret is shown once", async ({ browser }, info) => {
    const name = `UI key ${uid()}`;
    const { context, page, errors } = await openAs(browser, ACME.admin);
    try {
      await page.goto("/dashboard/settings/api-keys");
      await page.getByRole("button", { name: "Create API key" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Role").selectOption("member");
      await expect(dialog.getByLabel("Role").locator("option[value=owner]")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Create key" }).click();
      const secretBox = page.getByTestId("api-key-secret");
      await expect(secretBox).toHaveText(/^al_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
      const secret = (await secretBox.textContent()) ?? "";
      await expect(dialog.getByText("You won't see this key again")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("api-key-secret", info.project.name) });
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(page.getByTestId("api-key-secret")).toHaveCount(0);
      await expect(page.getByText(name)).toBeVisible();
      expect(await page.content()).not.toContain(secret);
      await page.reload();
      expect(await page.content()).not.toContain(secret);

      await page.getByRole("button", { name: `Revoke ${name}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Revoke key" }).click();
      await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Revoked");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("do not contact: add an entry and check an address", async ({ browser }, info) => {
    const domain = `ui-${uid()}.example`;
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await page.goto("/dashboard/settings/do-not-contact");
      await page.getByRole("button", { name: "Add entry" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email or domain").fill(domain.toUpperCase());
      await dialog.getByRole("button", { name: "Add to list" }).click();
      await expect(dialog).toBeHidden();
      await page.getByLabel("Search the list").fill(domain);
      await page.getByLabel("Search the list").press("Enter");
      await expect(page.getByRole("list", { name: "Do-not-contact entries" }).getByText(domain)).toBeVisible();

      await page.getByPlaceholder("name@example.com").first().fill(`someone@${domain}`);
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByText("Do not contact", { exact: true }).last()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("do-not-contact", info.project.name), fullPage: true });

      await page.getByLabel("Email address", { exact: true }).last().fill(`gone-${uid()}@example.org`);
      await page.getByRole("button", { name: "Erase person" }).click();
      const erase = page.getByRole("dialog");
      await expect(erase.getByRole("button", { name: "Erase permanently" })).toBeDisabled();
      await erase.getByRole("button", { name: "Cancel" }).click();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("members and audit log render their data", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.owner);
    try {
      await page.goto("/dashboard/settings/members");
      await expect(page.getByTestId("member-row").filter({ hasText: "viewer@acme.test" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Role for Acme Viewer" })).toHaveValue("viewer");
      await page.getByRole("button", { name: "Invite member" }).click();
      await expect(page.getByRole("dialog").getByLabel("Role").locator("option")).toHaveCount(5);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: shot("members", info.project.name), fullPage: true });

      await page.goto("/dashboard/settings/audit-log?action=task.");
      await expect(page.getByRole("list", { name: "Audit entries" })).toBeVisible();
      await expect(page.getByLabel("Area")).toHaveValue("task.");
      await expectNoHorizontalOverflow(page);

      await page.goto("/dashboard/account");
      await expect(page.getByLabel("Email")).toHaveValue(ACME.owner);
      await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
