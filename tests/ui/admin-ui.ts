import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { BASE_URL, browserAs } from "../support/session";

/** Console errors and uncaught page errors for the whole page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The page never scrolls sideways; wide tables and the deal board scroll inside their own container. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function openAs(
  browser: Browser,
  email: string,
  opts: { dark?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browserAs(browser, email);
  if (opts.dark) await context.addCookies([{ name: "theme_mode", value: "dark", url: BASE_URL }]);
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page) };
}

/** Screenshots only under .playwright-mcp/ (gitignored). */
export function shot(name: string, project: string): string {
  return `.playwright-mcp/admin-${project}-${name}.png`;
}

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const isMobile = (project: string) => project === "ui-mobile";
