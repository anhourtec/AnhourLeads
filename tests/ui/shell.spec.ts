import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, isMobile, openAs } from "./admin-ui";
import { openSidebar, ownErrors, wpaShot } from "./shell-ui";

test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const GROUPS = ["Prospect and enrich", "Engage", "Win deals", "Tools and automation", "Inbound", "Saved records"];

test.describe("app shell", () => {
  for (const role of ROLES) {
    test(`sidebar groups, footer and header for ${role}`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "manager" });
      try {
        const res = await page.goto("/dashboard/people");
        expect(res?.status()).toBe(200);

        // Header: search box, bell, avatar; AI Assistant only with ai:use (hidden on phones).
        await expect(page.getByRole("button", { name: "Search or ask a question" })).toBeVisible();
        await expect(page.getByRole("button", { name: /Activity and notifications/ })).toBeVisible();
        await expect(page.getByRole("button", { name: /Account menu for/ })).toBeVisible();
        const assistant = page.locator("header").first().getByRole("link", { name: "AI Assistant" });
        if (can(role, "ai:use") && !isMobile(info.project.name)) await expect(assistant).toBeVisible();
        else if (!can(role, "ai:use")) await expect(assistant).toHaveCount(0);

        const sidebar = await openSidebar(page, info.project.name);
        await expect(sidebar.getByRole("link", { name: "Home", exact: true })).toBeVisible();
        await expect(sidebar.getByRole("link", { name: "Calls" }).first()).toBeVisible();
        for (const group of GROUPS) await expect(sidebar.getByRole("button", { name: group })).toBeVisible();
        await expect(sidebar.getByRole("link", { name: "Workflows" })).toHaveCount(can(role, "workflow:read") ? 1 : 0);
        await expect(sidebar.getByRole("link", { name: "AI Assistant" })).toHaveCount(can(role, "ai:use") ? 1 : 0);
        // Same gate as the page: everyone who can read contacts sees the data health center.
        await expect(sidebar.getByRole("link", { name: "Data enrichment" })).toHaveCount(
          can(role, "contact:read") ? 1 : 0,
        );
        await expect(sidebar.getByRole("link", { name: "Email setup and health" })).toHaveCount(
          can(role, "deliverability:read") ? 1 : 0,
        );
        // The old settings group is gone from the main navigation.
        await expect(sidebar.getByRole("link", { name: "Members" })).toHaveCount(0);
        // Viewers have nothing to set up, so they get no onboarding hub card.
        await expect(sidebar.getByTestId("onboarding-hub-card")).toHaveCount(role === "viewer" ? 0 : 1);

        // Active item, then collapse a group and keep it collapsed after a reload.
        await expect(sidebar.getByRole("link", { name: "People" }).first()).toHaveAttribute("aria-current", "page");
        // Retry the click in case it lands before the sidebar has hydrated.
        await expect(async () => {
          await sidebar.getByRole("button", { name: "Inbound" }).click();
          await expect(sidebar.getByRole("link", { name: "Forms" })).toHaveCount(0, { timeout: 2_000 });
        }).toPass();
        await page.reload();
        const again = await openSidebar(page, info.project.name);
        await expect(again.getByRole("button", { name: "Saved records" })).toBeVisible();
        await expect(again.getByRole("link", { name: "Forms" })).toHaveCount(0);
        await again.getByRole("button", { name: "Inbound" }).click();
        await expect(again.getByRole("link", { name: "Forms" })).toBeVisible();

        // Admin settings menu.
        await again.getByRole("button", { name: "Admin settings" }).click();
        const menu = page.getByRole("menu");
        await expect(menu.getByText("Workspace setup")).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: "System activity" })).toHaveCount(
          can(role, "audit:read") ? 1 : 0,
        );
        await expect(menu.getByRole("menuitem", { name: "All settings" })).toBeVisible();
        await page.keyboard.press("Escape");

        if (role === "owner" || role === "viewer") {
          await page.screenshot({ path: wpaShot(`shell-${role}`, info.project.name) });
        }
        await expectNoHorizontalOverflow(page);
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("command palette finds a seeded person and opens them", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto("/dashboard/home");
      await page.keyboard.press("ControlOrMeta+k");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Suggestions")).toBeVisible();
      await expect(dialog.getByRole("option", { name: /Build your target audience/ })).toBeVisible();
      await dialog.getByRole("combobox").fill("Aisha");
      const person = dialog.getByRole("option", { name: /Aisha Khan/ }).first();
      await expect(person).toBeVisible();
      await expect(dialog.getByRole("option", { name: "View all people" })).toBeVisible();
      await page.screenshot({ path: wpaShot("cmdk-search", info.project.name) });
      await person.click();
      // The person page may compile on first visit in dev.
      await expect(page).toHaveURL(/\/dashboard\/people\/[0-9a-f-]{36}$/, { timeout: 60_000 });

      // Settings results, and the box opens from the header button too.
      await page.getByRole("button", { name: "Search or ask a question" }).click();
      await page.getByRole("dialog").getByRole("combobox").fill("do not contact");
      await expect(page.getByRole("dialog").getByRole("option", { name: /Do not contact/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("notifications popover shows activities and notifications", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await page.goto("/dashboard/home");
      await page.getByRole("button", { name: /Activity and notifications/ }).click();
      await expect(page.getByRole("tab", { name: "Activities" })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Notifications/ })).toBeVisible();
      await expect(
        page.getByText("You're all caught up").or(page.getByRole("list", { name: "Notifications" })),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Activities" }).click();
      await expect(
        page.getByText("No activity in this workspace yet.").or(page.getByRole("list", { name: "Recent activity" })),
      ).toBeVisible();
      await page.screenshot({ path: wpaShot("notifications", info.project.name) });
      await expectNoHorizontalOverflow(page);
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("scrollbars show only while scrolling", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, ACME.owner, { dark: true });
    try {
      await page.goto("/dashboard/people?segment=total");
      await expect(page.getByRole("heading", { name: "Find people" })).toBeVisible();
      const hidden = "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)";
      const state = (selector: string) =>
        page.evaluate((s) => {
          const el = document.querySelector(s) as Element;
          return { scrolling: el.hasAttribute("data-scrolling"), color: getComputedStyle(el).scrollbarColor };
        }, selector);

      // The page itself, and any inner scroll container (one is added here so every viewport has one).
      await page.evaluate(() => {
        const box = document.createElement("div");
        box.id = "scroll-probe";
        box.style.cssText = "height:80px;overflow:auto";
        box.innerHTML = '<div style="height:400px"></div>';
        document.body.append(box);
      });
      for (const selector of ["html", "#scroll-probe"]) {
        await expect.poll(() => state(selector)).toEqual({ scrolling: false, color: hidden });
        await page.evaluate((s) => {
          const el = document.querySelector(s) as Element;
          (s === "html" ? window : el).scrollBy(0, 40);
        }, selector);
        await expect.poll(async () => (await state(selector)).scrolling).toBe(true);
        expect((await state(selector)).color).not.toBe(hidden);
        await expect.poll(() => state(selector), { timeout: 5_000 }).toEqual({ scrolling: false, color: hidden });
      }
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("avatar menu holds profile, theme and display preferences", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, ACME.admin);
    try {
      await page.goto("/dashboard/home");
      await page.getByRole("button", { name: /Account menu for/ }).click();
      await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Notification settings" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
      await page.getByRole("menuitem", { name: "Display preferences" }).click();
      await expect(page.getByRole("dialog", { name: "Display preferences" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Account menu for/ }).click();
      await page.getByRole("menuitem", { name: "Profile" }).click();
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/);
      await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("settings shell", () => {
  for (const role of ROLES) {
    test(`settings sidebar and overview for ${role}`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "admin" });
      try {
        const res = await page.goto("/dashboard/settings");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeVisible();
        const main = page.getByRole("main");
        await expect(main.getByRole("link", { name: "Profile" })).toBeVisible();
        await expect(main.getByRole("link", { name: "API keys" })).toHaveCount(can(role, "apikey:read") ? 1 : 0);
        await expect(main.getByRole("link", { name: "Add teammates" })).toHaveCount(can(role, "member:invite") ? 1 : 0);

        const sidebar = await openSidebar(page, info.project.name);
        await expect(sidebar.getByRole("link", { name: "Back" })).toBeVisible();
        await expect(sidebar.getByRole("link", { name: "Settings overview" })).toBeVisible();
        for (const group of ["Personal", "Usage & activity", "Users & teams", "Outbound", "Data management"]) {
          await expect(sidebar.getByRole("button", { name: group })).toBeVisible();
        }
        await expect(sidebar.getByRole("button", { name: "White-label" })).toHaveCount(
          can(role, "branding:update") || can(role, "domain:read") ? 1 : 0,
        );
        await sidebar.getByRole("searchbox", { name: "Search settings" }).fill("api");
        await expect(sidebar.getByRole("link", { name: "API keys" })).toHaveCount(can(role, "apikey:read") ? 1 : 0);
        await sidebar.getByRole("searchbox", { name: "Search settings" }).fill("profile");
        await expect(sidebar.getByRole("link", { name: "Profile" })).toBeVisible();
        if (role === "owner" || role === "viewer") {
          await page.screenshot({ path: wpaShot(`settings-${role}`, info.project.name), fullPage: true });
        }
        await sidebar.getByRole("link", { name: "Profile" }).click();
        await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/, { timeout: 60_000 });
        await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible({ timeout: 60_000 });
        await expectNoHorizontalOverflow(page);

        // Back leaves the settings shell for the app sidebar.
        const settingsSidebar = await openSidebar(page, info.project.name);
        await settingsSidebar.getByRole("link", { name: "Back" }).click();
        await expect(page).toHaveURL(/\/dashboard\/home$/);
        const appSidebar = await openSidebar(page, info.project.name);
        await expect(appSidebar.getByRole("button", { name: "Prospect and enrich" })).toBeVisible();
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("existing settings pages render inside the settings shell", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.owner);
    try {
      for (const [path, title] of [
        ["/dashboard/settings/members", "Members"],
        ["/dashboard/settings/api-keys", "API keys"],
        ["/dashboard/settings/branding", "Branding"],
        ["/dashboard/settings/domains", "Domains"],
        ["/dashboard/settings/audit-log", "Audit log"],
        ["/dashboard/settings/do-not-contact", "Do not contact"],
        ["/dashboard/settings/notifications", "Notification settings"],
        ["/dashboard/settings/workspace", "Workspace details"],
      ] as const) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        // On phones the settings sidebar is a closed sheet until opened.
        if (!isMobile(info.project.name)) {
          await expect(page.getByRole("searchbox", { name: "Search settings" })).toBeAttached();
        }
      }
      const account = await page.goto("/dashboard/account");
      expect(account?.status()).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/);
      expect(ownErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("features not available yet", () => {
  for (const [path, title] of [
    ["/dashboard/calls", "Calls"],
    ["/dashboard/meetings", "Meetings"],
    ["/dashboard/conversations", "Conversations"],
    ["/dashboard/website-visitors", "Website visitors"],
    ["/dashboard/forms", "Forms"],
  ] as const) {
    test(`${title} shows an honest empty state`, async ({ browser }, info) => {
      const { context, page, errors } = await openAs(browser, ACME.member, { dark: title === "Meetings" });
      try {
        const res = await page.goto(path);
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        await expect(page.getByText("Not available in this installation yet")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: wpaShot(`empty-${title.toLowerCase().replace(/ /g, "-")}`, info.project.name),
          fullPage: true,
        });
        expect(ownErrors(errors)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
