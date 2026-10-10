import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { api, closeFilters, expectNoHorizontalOverflow, openAs, openFilters, shot, uid } from "./records-ui";

test.describe.configure({ timeout: 90_000 });

// The dev server compiles routes on first visit; give navigations room.
const expect = baseExpect.configure({ timeout: 15_000 });

/** A person imported from CSV (so provenance reads csv_import), at a fresh company. */
async function importPerson(tag: string, extra = "") {
  const owner = await api(ACME.owner);
  const csv = `First name,Last name,Email,Title,Company,Website,Stage\nUi${tag},Person,ui-${tag}@ui-${tag}.example,Head of tests,UiCo ${tag},ui-${tag}.example,new\n${extra}`;
  const res = await owner.post("/api/v1/contacts/import", { data: { csv } });
  expect(res.status()).toBe(200);
  const found = await (await owner.post("/api/v1/contacts/search", { data: { q: `ui-${tag}@` } })).json();
  return found.contacts[0] as { id: string; name: string; company: { id: string; name: string } };
}

test.describe("people screen", () => {
  test("member searches, filters and opens a person with provenance", async ({ browser }, info) => {
    const tag = uid();
    const person = await importPerson(tag);
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/people");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add person" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Export" })).toHaveAttribute("href", /\/api\/v1\/contacts\/export/);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("searchbox", { name: "Search people" }).fill(`ui-${tag}@`);
      await expect(page).toHaveURL(/q=ui-/);
      await expect(page.getByRole("link", { name: person.name })).toBeVisible();
      await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);

      // Stage filter: "Replied" hides the new person, "New" brings them back.
      const filters = await openFilters(page);
      await filters.getByRole("checkbox", { name: "Replied" }).click();
      await expect(page).toHaveURL(/stage=replied/);
      await closeFilters(page);
      await expect(page.getByText("No people match these filters")).toBeVisible();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(page).not.toHaveURL(/stage=/);

      await page.goto(`/dashboard/people?q=ui-${tag}%40&stage=new`);
      await expect(page.getByRole("link", { name: person.name })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-list", info.project.name), fullPage: true, caret: "initial" });

      await page.getByRole("link", { name: person.name }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/people/${person.id}`));
      await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
      await expect(page.getByText(`ui-${tag}@ui-${tag}.example`).first()).toBeVisible();
      await expect(page.getByTestId("provenance").first()).toContainText(/csv_import · .*ago · 90%/);
      await expect(page.getByRole("link", { name: `UiCo ${tag}` })).toHaveAttribute(
        "href",
        `/dashboard/companies/${person.company.id}`,
      );
      await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("person-detail", info.project.name), fullPage: true, caret: "initial" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("member adds, edits and imports people", async ({ browser }) => {
    const tag = uid();
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      await page.goto("/dashboard/people");
      await page.getByRole("button", { name: "Add person" }).click();
      const dialog = page.getByRole("dialog", { name: "Add person" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Add person" }).click();
      await expect(dialog.getByText("Give the person a name or an email address.")).toBeVisible();
      await dialog.getByLabel("First name").fill("Dialog");
      await dialog.getByLabel("Last name").fill(`Added ${tag}`);
      await dialog.getByLabel("Email").fill(`dialog-${tag}@ui-people.example`);
      await dialog.getByLabel("Title").fill("Buyer");
      await dialog.getByLabel("Stage").selectOption("contacted");
      await dialog.getByRole("button", { name: "Add person" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(`Dialog Added ${tag} added.`)).toBeVisible();

      await page.getByRole("searchbox", { name: "Search people" }).fill(`dialog-${tag}`);
      await expect(page).toHaveURL(/q=dialog-/);
      await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
      const link = page.getByRole("link", { name: `Dialog Added ${tag}` });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page.getByRole("heading", { level: 1, name: `Dialog Added ${tag}` })).toBeVisible();
      await expect(page.getByTestId("provenance").first()).toContainText("manual");

      await page.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: /^Edit/ });
      await edit.getByLabel("Title").fill("Head of buying");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit).toBeHidden();
      await expect(page.getByText("Head of buying").first()).toBeVisible();

      // Import a CSV through the dialog and read the report.
      await page.goto("/dashboard/people");
      await page.getByRole("button", { name: "Import CSV" }).click();
      const importer = page.getByRole("dialog", { name: "Import people from CSV" });
      await importer.getByLabel("CSV file").setInputFiles({
        name: "people.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(`email,first name\nimp-${tag}@ui-people.example,Imported\nbad-email,Nope\n`),
      });
      await importer.getByRole("button", { name: "Import" }).click();
      await expect(importer.getByText("Created")).toBeVisible();
      await expect(importer.getByText("Row 3")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await importer.getByRole("button", { name: "Done" }).click();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("manager changes stage in bulk and deletes", async ({ browser }) => {
    const tag = uid();
    const person = await importPerson(tag);
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await page.goto(`/dashboard/people?q=ui-${tag}%40`);
      await page.getByRole("checkbox", { name: `Select ${person.name}` }).click();
      const bulk = page.getByRole("group", { name: "Bulk actions" });
      await expect(bulk).toBeVisible();
      await bulk.getByLabel("Change stage").selectOption("interested");
      await expect(page.getByText(/Moved 1 person to Interested/)).toBeVisible();
      await expect(page.getByRole("table").getByText("Interested")).toBeVisible();

      await page.getByRole("checkbox", { name: `Select ${person.name}` }).click();
      await bulk.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Deleted 1 person.")).toBeVisible();
      await expect(page.getByText("No people match these filters")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewer sees no write controls", async ({ browser }) => {
    const tag = uid();
    const person = await importPerson(tag);
    const { context, page, errors } = await openAs(browser, ACME.viewer);
    try {
      await page.goto(`/dashboard/people?q=ui-${tag}%40`);
      await expect(page.getByRole("link", { name: person.name })).toBeVisible();
      for (const name of ["Add person", "Import CSV"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Export" })).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: `Select ${person.name}` })).toHaveCount(0);
      await page.getByRole("link", { name: person.name }).click();
      await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("suppressed people show a banner; dark mode has no overflow", async ({ browser }, info) => {
    const owner = await api(ACME.owner);
    const tag = uid();
    const res = await owner.post("/api/v1/contacts", {
      data: { firstName: "Blocked", lastName: tag, email: `blocked-${tag}@competitor.example` },
    });
    expect(res.status()).toBe(201);
    const { contact } = await res.json();
    const { context, page, errors } = await openAs(browser, ACME.member, { dark: true });
    try {
      await page.goto(`/dashboard/people/${contact.id}`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByText("On the do-not-contact list")).toBeVisible();
      await expect(page.getByText("Suppressed").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: shot("person-suppressed-dark", info.project.name),
        fullPage: true,
        caret: "initial",
      });
      await page.goto("/dashboard/people");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("people-dark", info.project.name), fullPage: true, caret: "initial" });

      expect(errors).toEqual([]);

      // Unknown ids are checked before the loading boundary, so they get a real 404 status.
      const missing = await page.goto("/dashboard/people/00000000-0000-0000-0000-000000000000");
      expect(missing?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});
