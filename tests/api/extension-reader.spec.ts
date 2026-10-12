import { expect, type Page, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { apiAs, apiAsRole, apiWithKey, GLOBEX_OWNER } from "../support/session";
import { acmeKey, createKey, uniq } from "./admin-helpers";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The browser extension (extension/): the page reader on synthetic markup (never a real LinkedIn
 * page), and the API calls the popup makes with an API key.
 */

/**
 * The reader as the popup injects it: the function's source evaluated on its own in the page, so
 * any reference to something outside the function fails here as it would in a real tab.
 */
const READER = readFileSync(path.resolve(__dirname, "../../extension/reader.js"), "utf8").replace(/^export /m, "");

interface PersonDraft {
  firstName: string;
  lastName: string;
  title: string;
  companyName: string;
  companyDomain: string;
  location: string;
  linkedinUrl: string;
  email: string;
  pageUrl: string;
  via: string;
}

async function read(page: Page, html: string, href: string): Promise<PersonDraft | null> {
  await page.setContent(html);
  return page.evaluate(`(${READER})(document, { href: ${JSON.stringify(href)} })`);
}

const linkedinProfile = `<!doctype html><html><head><title>Jane Q. Doe | LinkedIn</title>
<meta property="og:title" content="Jane Q. Doe - Northwind Labs | LinkedIn"></head>
<body><header><a href="/feed/">Home</a></header>
<main>
  <section class="artdeco-card">
    <div class="ph5">
      <div class="mt2"><div><h1 class="text-heading-xlarge">Jane Q. Doe</h1></div>
        <div class="text-body-medium break-words">Head of Growth at Northwind Labs | Speaker</div>
        <div><span class="text-body-small inline t-black--light">Austin, Texas, United States</span>
          <span><a href="/in/jane-doe-123/overlay/contact-info/">Contact info</a></span></div>
        <ul><li><span class="t-bold">500+ connections</span></li></ul>
      </div>
      <ul><li><button aria-label="Current company: Northwind Labs. Click to skip to experience card">Northwind Labs</button></li></ul>
    </div>
  </section>
  <section><h2>Experience</h2><ul><li>Head of Growth · Northwind Labs</li><li>Marketing lead · Contoso</li></ul></section>
  <aside><h2>People also viewed</h2><ul>
    <li><a href="https://www.linkedin.com/in/someone-else/">Someone Else</a> CTO at Fabrikam</li>
    <li><a href="https://www.linkedin.com/in/another-person/">Another Person</a> VP Sales at Initech</li>
  </ul></aside>
</main></body></html>`;

const searchResults = `<!doctype html><html><body><main><h1>Search results</h1><ul>
${Array.from(
  { length: 10 },
  (_, i) => `<li><a href="https://www.linkedin.com/in/person-${i}/"><span>Person ${i}</span></a>
  <div class="text-body-medium">Director at Company ${i}</div></li>`,
).join("\n")}
</ul></main></body></html>`;

const teamBio = `<!doctype html><html><head><title>Ada Lovelace · Northwind Labs</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "ProfilePage",
  mainEntity: {
    "@type": "Person",
    name: "Ada Lovelace",
    jobTitle: "Chief Technology Officer",
    worksFor: { "@type": "Organization", name: "Northwind Labs", url: "https://www.northwind.example/" },
    address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "United Kingdom" },
    email: "mailto:ada@northwind.example",
    sameAs: ["https://www.linkedin.com/in/ada-lovelace-nw/", "https://social.example/@ada"],
  },
})}</script>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Northwind Labs",
  employee: [
    { "@type": "Person", name: "Ada Lovelace" },
    { "@type": "Person", name: "Grace Hopper" },
  ],
})}</script></head>
<body><h1>Ada Lovelace</h1><p>Chief Technology Officer</p><a href="/team">Back to the team</a></body></html>`;

const teamPage = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Person", name: "Ada Lovelace", jobTitle: "CTO" },
    { "@type": "Person", name: "Grace Hopper", jobTitle: "CEO" },
    { "@type": "Person", name: "Alan Turing", jobTitle: "Head of research" },
  ],
})}</script></head><body><h1>Our team</h1></body></html>`;

const microdataBio = `<!doctype html><html><body>
<article itemscope itemtype="https://schema.org/Person">
  <h1 itemprop="name">Grace Hopper</h1>
  <p><span itemprop="jobTitle">Chief Executive Officer</span> at
    <span itemprop="worksFor" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Fabrikam</span></span></p>
  <p itemprop="address">Arlington, Virginia</p>
  <a href="https://www.linkedin.com/in/grace-hopper-fab">LinkedIn</a>
</article></body></html>`;

const microdataTeam = `<!doctype html><html><body>
<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">One Person</span></div>
<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Two Person</span></div>
</body></html>`;

const openGraphProfile = `<!doctype html><html><head>
<meta property="og:type" content="profile"><meta property="og:title" content="Alan Turing - Speaker profile">
<meta property="profile:first_name" content="Alan"><meta property="profile:last_name" content="Turing">
</head><body><h1>Alan Turing</h1></body></html>`;

test.describe("extension reader", () => {
  test("LinkedIn profile page: name, headline, current company, location, canonical URL", async ({ page }) => {
    const person = await read(page, linkedinProfile, "https://www.linkedin.com/in/jane-doe-123/?originalSubdomain=uk");
    expect(person).toEqual({
      firstName: "Jane Q.",
      lastName: "Doe",
      title: "Head of Growth",
      companyName: "Northwind Labs",
      companyDomain: "",
      location: "Austin, Texas, United States",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe-123",
      email: "",
      pageUrl: "https://www.linkedin.com/in/jane-doe-123/?originalSubdomain=uk",
      via: "linkedin",
    });
  });

  test("LinkedIn pages other than one profile return nothing", async ({ page }) => {
    expect(await read(page, searchResults, "https://www.linkedin.com/search/results/people/?keywords=director")).toBe(
      null,
    );
    expect(await read(page, searchResults, "https://www.linkedin.com/company/northwind/people/")).toBe(null);
    expect(await read(page, searchResults, "https://www.linkedin.com/feed/")).toBe(null);
    // A profile URL whose page holds a list (several headings) still yields no one.
    const listy = searchResults.replace(/<span>(Person \d)<\/span>/g, "<h1>$1</h1>");
    expect(await read(page, listy, "https://www.linkedin.com/in/person-1/")).toBe(null);
  });

  test("JSON-LD bio page: the page's main person, not the team list", async ({ page }) => {
    const person = await read(page, teamBio, "https://www.northwind.example/team/ada-lovelace");
    expect(person).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      title: "Chief Technology Officer",
      companyName: "Northwind Labs",
      companyDomain: "northwind.example",
      location: "London, United Kingdom",
      linkedinUrl: "https://www.linkedin.com/in/ada-lovelace-nw",
      email: "ada@northwind.example",
      pageUrl: "https://www.northwind.example/team/ada-lovelace",
      via: "json-ld",
    });
  });

  test("pages listing several people return nothing", async ({ page }) => {
    expect(await read(page, teamPage, "https://www.northwind.example/team")).toBe(null);
    expect(await read(page, microdataTeam, "https://www.northwind.example/team")).toBe(null);
    expect(await read(page, searchResults, "https://directory.example/search?q=director")).toBe(null);
    expect(await read(page, "<html><body><h1>Pricing</h1></body></html>", "https://www.northwind.example/")).toBe(null);
  });

  test("microdata and OpenGraph profiles", async ({ page }) => {
    expect(await read(page, microdataBio, "https://fabrikam.example/leadership/grace")).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      title: "Chief Executive Officer",
      companyName: "Fabrikam",
      location: "Arlington, Virginia",
      linkedinUrl: "https://www.linkedin.com/in/grace-hopper-fab",
      via: "microdata",
    });
    expect(await read(page, openGraphProfile, "https://events.example/speakers/alan")).toMatchObject({
      firstName: "Alan",
      lastName: "Turing",
      via: "opengraph",
    });
  });

  test("non-web pages are never read", async ({ page }) => {
    expect(await read(page, linkedinProfile, "chrome://extensions/")).toBe(null);
    expect(await read(page, linkedinProfile, "file:///Users/me/profile.html")).toBe(null);
  });
});

test.describe("extension API flow (API key)", () => {
  test("save the way the popup does, find it again, viewer key refused", async () => {
    const tag = uniq("ext");
    const key = await apiWithKey((await acmeKey("member")).secret);
    const profile = await (await key.get("/api/v1/users/api_profile")).json();
    expect(profile).toMatchObject({ authenticatedAs: "apiKey", role: "member", workspace: { slug: "acme" } });
    expect(profile.permissions).toEqual(expect.arrayContaining(["contact:create", "company:create", "list:update"]));

    // Company: looked up by domain, created when missing (runDedupe keeps it idempotent).
    const domain = `${tag}.example`;
    const search = await key.post("/api/v1/accounts/search", { data: { domains: [domain], per_page: 1 } });
    expect(search.status()).toBe(200);
    expect((await search.json()).accounts).toEqual([]);
    const company = await key.post("/api/v1/accounts", { data: { name: `Northwind ${tag}`, domain, runDedupe: true } });
    expect(company.status(), await company.text()).toBe(201);
    const companyId = (await company.json()).account.id;

    const linkedinUrl = `https://www.linkedin.com/in/${tag}`;
    const sourceUrl = `https://www.linkedin.com/in/${tag}/?originalSubdomain=uk`;
    const created = await key.post("/api/v1/contacts", {
      data: {
        firstName: "Jane",
        lastName: `Doe ${tag}`,
        title: "Head of Growth",
        linkedinUrl,
        companyId,
        city: "Austin",
        state: "Texas",
        country: "United States",
        source: "browser_extension",
        sourceUrl,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const contact = (await created.json()).contact;
    expect(contact).toMatchObject({ source: "browser_extension", linkedinUrl, company: { id: companyId } });

    // Duplicate check: name search, then compare the LinkedIn URL.
    const found = await key.post("/api/v1/contacts/search", { data: { name: `Jane Doe ${tag}`, per_page: 25 } });
    const rows = (await found.json()).contacts as { id: string; linkedinUrl: string | null }[];
    expect(rows.find((r) => r.linkedinUrl === linkedinUrl)?.id).toBe(contact.id);

    const prov = (await (await key.get(`/api/v1/contacts/${contact.id}/provenance`)).json()).provenance;
    expect(prov.find((p: { field: string }) => p.field === "linkedinUrl")).toMatchObject({
      source: "browser_extension",
      sourceUrl,
    });

    // Add to a static list.
    const owner = await apiAsRole("owner");
    const list = await owner.post("/api/v1/labels", { data: { name: `Extension ${tag}`, entityType: "contact" } });
    expect(list.status(), await list.text()).toBe(201);
    const listId = (await list.json()).label.id;
    const lists = await (await key.get("/api/v1/labels?entityType=contact")).json();
    expect(lists.labels.some((l: { id: string; kind: string }) => l.id === listId && l.kind === "static")).toBe(true);
    const added = await key.post("/api/v1/labels/add_entity_ids", { data: { listId, entityIds: [contact.id] } });
    expect(added.status(), await added.text()).toBe(200);
    expect((await added.json()).added).toBe(1);

    // The other workspace can't see it.
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/contacts/${contact.id}`)).status()).toBe(404);
    const globexSearch = await globex.post("/api/v1/contacts/search", { data: { name: `Jane Doe ${tag}` } });
    expect((await globexSearch.json()).contacts).toEqual([]);

    // A viewer key can read but not save.
    const viewer = await apiWithKey((await acmeKey("viewer")).secret);
    const refused = await viewer.post("/api/v1/contacts", {
      data: { firstName: "Viewer", lastName: tag, source: "browser_extension", sourceUrl },
    });
    expect(refused.status()).toBe(403);
    expect((await viewer.post("/api/v1/contacts/search", { data: { name: "Jane" } })).status()).toBe(200);

    // An invalid key is a 401.
    const bogus = await apiWithKey("al_00000000_notarealkeynotarealkeynotarealkeynotareal");
    expect((await bogus.get("/api/v1/users/api_profile")).status()).toBe(401);
  });

  test("every role's API key: saving follows contact:create", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const { secret } = await createKey(owner, role, uniq(`ext-${role}`));
      const key = await apiWithKey(secret);
      const res = await key.post("/api/v1/contacts", {
        data: {
          firstName: "Key",
          lastName: `${role} ${uniq()}`,
          source: "browser_extension",
          sourceUrl: "https://northwind.example/team",
        },
      });
      expect(res.status(), role).toBe(expected(role, "contact:create", 201));
      if (res.ok()) expect((await res.json()).contact.source).toBe("browser_extension");
    }
  });
});
