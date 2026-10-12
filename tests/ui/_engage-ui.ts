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

/** The page itself never scrolls horizontally; tables scroll inside their own container. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function signedInPage(
  browser: Browser,
  email: string,
  opts: { dark?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browserAs(browser, email);
  if (opts.dark) await context.addCookies([{ name: "theme_mode", value: "dark", url: BASE_URL }]);
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page) };
}

/** Screenshot path under .playwright-mcp/ (gitignored), unique per project. */
export function shot(name: string, project: string): string {
  return `.playwright-mcp/engage-${project}-${name}.png`;
}

export const runId = (project: string) => `${project}-${Date.now().toString(36)}`;
