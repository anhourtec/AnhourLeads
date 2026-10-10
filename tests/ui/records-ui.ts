import { type APIRequestContext, type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { apiAs, browserAs } from "../support/session";

/** Helpers for the people and companies UI specs. */

let seq = 0;
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function openAs(
  browser: Browser,
  email: string,
  options: { dark?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browserAs(browser, email);
  if (options.dark) {
    await context.addCookies([{ name: "theme_mode", value: "dark", url: "http://localhost:3410" }]);
  }
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page) };
}

export function shot(name: string, project: string): string {
  return `.playwright-mcp/records-${project}-${name}.png`;
}

/** Filters live in a left column from 1024 px and in a sheet below that. */
export async function openFilters(page: Page): Promise<import("@playwright/test").Locator> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1024) return page.getByRole("complementary", { name: "Filters" });
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function closeFilters(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) await page.keyboard.press("Escape");
}

export async function api(email: string): Promise<APIRequestContext> {
  return apiAs(email);
}
