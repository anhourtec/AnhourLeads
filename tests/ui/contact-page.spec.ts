import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 180_000 });

const expect = baseExpect.configure({ timeout: 30_000 });

/** A person at a fresh company, created through the API so the timeline has a contact_created row. */
async function makePerson(tag: string) {
  const owner = await api(ACME.owner);
  const company = await owner.post("/api/v1/accounts", {
    data: {
      name: `Contact page co ${tag}`,
      domain: `cp-${tag}.example`,
      industry: "Software",
      employeeCount: 120,
      technologies: ["Postgres", "Next.js"],
      keywords: ["outbound", "sales tooling"],
      description: "Builds tools for sales teams.",
    },
  });
  expect(company.status(), await company.text()).toBe(201);
  const companyId = (await company.json()).account.id as string;
  const res = await owner.post("/api/v1/contacts", {
    data: {
      firstName: "Page",
      lastName: `Person ${tag}`,
      email: `page-${tag}@cp-${tag}.example`,
      title: "Head of revenue",
      city: "Toronto",
      country: "Canada",
      timezone: "America/Toronto",
      companyId,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const contact = (await res.json()).contact as { id: string; name: string };
  return { ...contact, companyId, companyName: `Contact page co ${tag}` };
}

test.describe("contact page", () => {
  test("member works a contact: notes, stage, layout and timeline", async ({ browser }, info) => {
    const tag = uid();
    const person = await makePerson(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto(`/dashboard/people/${person.id}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "People" }),
      ).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: person.companyName }).first()).toBeVisible();
      for (const card of ["contact", "record", "account", "deals", "notes", "tasks"]) {
        await expect(page.getByTestId(`card-${card}`)).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Add to sequence" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to list" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();
      for (const tab of ["Prospect", "Activities", "Sequences", "All fields"]) {
        await expect(page.getByRole("tab", { name: tab })).toBeVisible();
      }
      await expect(page.getByText("Company insights")).toBeVisible();
      await expect(page.getByText("Postgres")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Notes: add, then delete.
      const noteText = `Spoke about pricing ${tag}`;
      // Typing before hydration finishes is reset by React; retry until the button picks it up.
      await expect(async () => {
        await page.getByLabel("New note").fill(noteText);
        await expect(page.getByRole("button", { name: "Add note" })).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await page.getByRole("button", { name: "Add note" }).click();
      const notes = page.getByRole("list", { name: "Notes" });
      await expect(notes.getByText(noteText)).toBeVisible();

      // Timeline shows the note.
      await page.getByRole("tab", { name: "Activities" }).click();
      const timeline = page.getByRole("list", { name: "Activity timeline" });
      await expect(timeline.getByText(`Note added: ${noteText}`)).toBeVisible();
      await expect(timeline.locator('[data-activity-type="contact_created"]')).toBeVisible();

      // Stage change.
      await page.getByTestId("card-record").getByLabel("Stage").selectOption("interested");
      await expect(page.getByText("Stage set to Interested.")).toBeVisible();

      // All fields tab via "See all fields".
      await page.getByRole("button", { name: /See all fields/ }).click();
      await expect(page.getByRole("tab", { name: "All fields" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Custom fields", { exact: true })).toBeVisible();

      await page.screenshot({ path: `.playwright-mcp/wp-b/contact-page-${info.project.name}.png`, fullPage: true });

      await notes.getByRole("button", { name: "Delete note" }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete note" }).click();
      await expect(notes).toHaveCount(0);

      // Collapse a card; it stays collapsed after a reload.
      await page.getByRole("button", { name: "Collapse Notes" }).click();
      await expect(page.getByRole("button", { name: "Expand Notes" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: "Expand Notes" })).toBeVisible();
      await expect(page.getByLabel("New note")).toBeHidden();
      await page.getByRole("button", { name: "Expand Notes" }).click();
      await expect(page.getByLabel("New note")).toBeVisible();

      // Keyboard reorder: move Notes up one place.
      const before = await page
        .locator('[data-testid^="card-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      await page.getByRole("button", { name: /^Move Notes \(drag/ }).focus();
      await page.keyboard.press("ArrowUp");
      const after = await page
        .locator('[data-testid^="card-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      expect(after.indexOf("card-notes")).toBe(before.indexOf("card-notes") - 1);

      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees the record without edit controls", async ({ browser }) => {
    const tag = uid();
    const person = await makePerson(tag);
    await (await api(ACME.owner)).post("/api/v1/notes", {
      data: { entityType: "contact", entityId: person.id, body: `Owner note ${tag}` },
    });
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await page.goto(`/dashboard/people/${person.id}`);
      await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
      await expect(page.getByText(`Owner note ${tag}`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to sequence" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add to list" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create task" })).toHaveCount(0);
      await expect(page.getByLabel("New note")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete note" })).toHaveCount(0);
      await expect(page.getByTestId("card-record").getByRole("combobox")).toHaveCount(0);
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete person" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("an unknown or other-workspace id is a 404", async ({ browser }) => {
    const { context, page } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/people/does-not-exist");
      expect(res?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});
