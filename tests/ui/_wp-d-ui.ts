import type { Browser, BrowserContext, Page } from "@playwright/test";

import { userIdOf } from "../api/admin-helpers";
import { openAs } from "./admin-ui";

export { expectNoHorizontalOverflow } from "./admin-ui";

/** Screenshots for the deals, stages and workflows package. */
export function wpdShot(name: string, project: string): string {
  return `.playwright-mcp/wp-d/${project}-${name}.png`;
}

/** Open a page as `email`; by default the deals intro modal counts as already seen. */
export async function openAsUser(
  browser: Browser,
  email: string,
  opts: { dark?: boolean; showIntro?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const opened = await openAs(browser, email, { dark: opts.dark });
  if (!opts.showIntro) {
    const key = `anhour:deals-intro:${await userIdOf(email)}`;
    await opened.context.addInitScript((k) => window.localStorage.setItem(k, "seen"), key);
  }
  return opened;
}

/** Console noise that isn't from these screens (React dev warnings about third-party components, HMR). */
export function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(e));
}
