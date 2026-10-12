import { expect as baseExpect, test } from "@playwright/test";

import { ROLES } from "../../src/lib/rbac/permissions";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs } from "./admin-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

// The overview became Home (tests/ui/home.spec.ts covers its layouts). Old links keep working.
test.describe("overview redirects to home", () => {
  for (const role of ROLES) {
    test(`for ${role}`, async ({ browser }) => {
      const { context, page, errors } = await openAs(browser, ACME[role], { dark: role === "viewer" });
      try {
        const res = await page.goto("/dashboard/overview");
        expect(res?.status()).toBe(200);
        await expect(page).toHaveURL(/\/dashboard\/home$/);
        await expect(page.getByRole("button", { name: /Home layout:/ })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
