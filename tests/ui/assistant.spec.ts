import { type Browser, expect, type Page, test } from "@playwright/test";

import { ACME, apiAs, BASE_URL, browserAs } from "../support/session";

/**
 * AI assistant and AI context center at desktop, tablet and mobile widths. The dev server runs
 * without an AI provider: the setup state shows and the presets answer from workspace data.
 */

async function open(browser: Browser, email: string, dark = false) {
  const context = await browserAs(browser, email);
  if (dark) await context.addCookies([{ name: "theme_mode", value: "dark", url: BASE_URL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const shot = (name: string, project: string) => `.playwright-mcp/wp-e/assistant-${project}-${name}.png`;

/** Delete the chat a test created (its id is in the page URL). */
async function deleteChatFrom(email: string, page: Page) {
  const id = new URL(page.url()).searchParams.get("chat");
  if (id) await (await apiAs(email)).delete(`/api/v1/ai/chats/${id}`);
}

test.describe.configure({ timeout: 150_000 });

test.describe("AI assistant", () => {
  test("setup state, presets and free-form answers for a member", async ({ browser }, info) => {
    const { context, page, errors } = await open(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/assistant");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "AI assistant" })).toBeVisible();
      await expect(page.getByText("AI isn't set up in this installation")).toBeVisible();
      await expect(page.getByText("What would you like to work on?")).toBeVisible();
      await expect(page.getByRole("button", { name: "Workspace data: on" })).toHaveAttribute("aria-pressed", "true");
      for (const label of [
        "Build your target audience",
        "Write an account brief",
        "Draft a 3-step sequence",
        "Summarise the last 30 days",
      ]) {
        await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("empty", info.project.name), fullPage: true });

      // Analytics preset answers with numbers and a source link.
      await page.getByRole("button", { name: "Summarise the last 30 days", exact: true }).click();
      const conversation = page.getByRole("list", { name: "Conversation" });
      await expect(conversation.getByText(/Emails sent: \d/)).toBeVisible({ timeout: 30_000 });
      await expect(conversation.getByRole("link", { name: "Analytics", exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/dashboard\/assistant\?chat=/);

      // Research preset with an empty prompt asks for the company first.
      await page.getByRole("button", { name: "Write an account brief", exact: true }).click();
      const input = page.getByLabel("Message the AI assistant");
      await expect(input).toHaveValue("Account brief for ");
      await input.pressSequentially("zz-no-such-company-qq");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(conversation.getByText(/couldn't match a company/)).toBeVisible({ timeout: 30_000 });

      // Free-form questions explain how to turn AI on.
      await input.fill("Which accounts should I call today?");
      await input.press("Enter");
      await expect(conversation.getByText(/The AI assistant isn't set up/)).toBeVisible({ timeout: 30_000 });

      // The chat is listed in the left pane (a sheet below lg).
      if (info.project.name !== "ui-desktop") {
        await page.getByRole("button", { name: "Chats" }).click();
        await expect(
          page.getByRole("dialog").getByRole("link", { name: "Summarise the last 30 days" }).first(),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(
          page
            .getByRole("navigation", { name: "Assistant" })
            .getByRole("link", { name: "Summarise the last 30 days" })
            .first(),
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("conversation", info.project.name), fullPage: true });

      // Reloading the chat shows the stored messages.
      await page.reload();
      await expect(page.getByRole("list", { name: "Conversation" }).getByText(/Emails sent: \d/)).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await deleteChatFrom(ACME.member, page);
      await context.close();
    }
  });

  test("dark mode: sequence draft preset links to sequences", async ({ browser }, info) => {
    const { context, page, errors } = await open(browser, ACME.manager, true);
    try {
      await page.goto("/dashboard/assistant");
      await page.getByRole("button", { name: "Draft a 3-step sequence", exact: true }).click();
      const conversation = page.getByRole("list", { name: "Conversation" });
      await expect(
        conversation.getByRole("link", { name: /Open sequences|Open AI context center/ }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("dark-preset", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await deleteChatFrom(ACME.manager, page);
      await context.close();
    }
  });

  test("viewers can't open the assistant or the context center", async ({ browser }) => {
    const { context, page } = await open(browser, ACME.viewer);
    try {
      expect((await page.goto("/dashboard/assistant"))?.status()).toBe(404);
      expect((await page.goto("/dashboard/settings/ai-context"))?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});

test.describe("AI context center", () => {
  test("members see it read-only", async ({ browser }, info) => {
    const { context, page, errors } = await open(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/settings/ai-context");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "AI context center" })).toBeVisible();
      await expect(page.getByText("Only administrators and owners can change the AI context.")).toBeVisible();
      for (const label of ["Company description", "Value proposition", "Target customers", "Tone"]) {
        await expect(page.getByLabel(label)).toHaveAttribute("readonly", "");
      }
      await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("context-readonly", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("admins edit and save it", async ({ browser }, info) => {
    const api = await apiAs(ACME.admin);
    const original = (await (await api.get("/api/v1/ai/context")).json()).context;
    const { context, page, errors } = await open(browser, ACME.admin, true);
    try {
      await page.goto("/dashboard/settings/ai-context");
      const save = page.getByRole("button", { name: "Save" });
      await expect(save).toBeDisabled();
      const tone = page.getByLabel("Tone");
      // Unique per run: parallel screen sizes edit the same workspace context.
      const stamp = Date.now().toString(36);
      // Retry until the form has hydrated and reacts to typing.
      await expect(async () => {
        await tone.fill("");
        await tone.fill(`Plain and brief (${info.project.name} ${stamp}).`);
        await expect(save).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await save.click();
      await expect(page.getByText("AI context saved.")).toBeVisible();
      await expect(save).toBeDisabled();
      // The form shows what the server saved (another screen size may have saved in parallel).
      await expect(tone).toHaveValue(/^Plain and brief \(ui-/);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("context-admin-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await api.put("/api/v1/ai/context", {
        data: {
          companyDescription: original.companyDescription,
          valueProposition: original.valueProposition,
          targetCustomers: original.targetCustomers,
          tone: original.tone,
        },
      });
    }
  });
});
