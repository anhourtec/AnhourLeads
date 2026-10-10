import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

import { browserAs } from "../support/session";

/** Console errors and uncaught page errors, collected for the whole page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The page itself never scrolls horizontally (tables scroll inside their own container). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A signed-in page for `email`, with error collection. Close the context when done. */
export async function signedInPage(
  browser: Browser,
  email: string,
  baseURL?: string,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browserAs(browser, email, baseURL);
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page) };
}

/** Screenshot name under .playwright-mcp/ (gitignored), unique per project. */
export function shot(name: string, project: string): string {
  return `.playwright-mcp/white-label-${project}-${name}.png`;
}

/** Switch a context to dark mode (the theme boot script reads the theme_mode cookie). */
export async function setDarkMode(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: "theme_mode", value: "dark", url: baseURL }]);
}
