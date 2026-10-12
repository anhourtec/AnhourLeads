import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAsUser, realErrors } from "./_wp-d-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

/** Basic smoke for the deals route (detailed parity checks live in deals-parity.spec.ts). */
test("deals board shows the default pipeline's stages", async ({ browser }) => {
  const { context, page, errors } = await openAsUser(browser, ACME.viewer);
  try {
    const res = await page.goto("/dashboard/deals");
    expect(res?.status()).toBe(200);
    for (const stage of [
      "Lead",
      "Sales qualified",
      "Meeting booked",
      "Negotiation",
      "Contract sent",
      "Closed won",
      "Closed lost",
    ]) {
      await expect(page.locator(`[data-stage-name='${stage}']`)).toHaveCount(1);
    }
    await expectNoHorizontalOverflow(page);
    expect(realErrors(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});
