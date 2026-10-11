import { expect, type Locator, type Page } from "@playwright/test";

import { isMobile } from "./admin-ui";

/** Screenshots for the shell work package, under .playwright-mcp/wp-a/ (gitignored). */
export function wpaShot(name: string, project: string): string {
  return `.playwright-mcp/wp-a/${project}-${name}.png`;
}

/** The visible sidebar: the fixed rail on desktop and tablet, the sheet on phones (opened first). */
export async function openSidebar(page: Page, project: string): Promise<Locator> {
  if (isMobile(project)) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  }
  const sidebar = page.locator('[data-sidebar="sidebar"]:visible');
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/** Errors that come from the shared not-found page or dev tooling, not from our screens. */
export function ownErrors(errors: string[]): string[] {
  return errors.filter((e) => !/status of 404|Encountered a script tag|Download the React DevTools/.test(e));
}
