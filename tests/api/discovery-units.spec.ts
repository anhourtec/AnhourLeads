import { expect, test } from "@playwright/test";

import { extractPeople, jsonLdObjects, plausiblePersonName } from "../../src/server/crawler/extract";
import {
  atsApiUrl,
  atsBoardFromApiUrl,
  atsBoardFromUrl,
  detectAtsBoards,
  parseAtsJobs,
} from "../../src/server/discovery/ats";
import {
  backoffMs,
  companyDomainFor,
  companyNameFromTitle,
  countryName,
  departmentFromTitle,
  employeeRangeFor,
  hostDelayMs,
  isOtherLocale,
  isReservedHost,
  kindForUrl,
  personOptoutKey,
  recrawlIntervalMs,
  seedUrlsFromText,
  seniorityFromTitle,
} from "../../src/server/discovery/classify";
import { isDeniedHost, isDeniedUrl } from "../../src/server/discovery/denylist";
import { feedLinks, parseFeed, parseSitemap } from "../../src/server/discovery/feeds";
import { buildWikidataQuery, parseWikidataResults, wikidataRequestUrl } from "../../src/server/discovery/wikidata";

/** Pure functions behind the discovery pipeline, tested without HTTP or a database. */

test.describe("deny-list", () => {
  test("social networks, walled gardens and data vendors are denied, with subdomains", () => {
    for (const host of [
      "linkedin.com",
      "www.linkedin.com",
      "uk.linkedin.com",
      "facebook.com",
      "m.facebook.com",
      "instagram.com",
      "x.com",
      "twitter.com",
      "tiktok.com",
      "www.glassdoor.com",
      "indeed.com",
      "zoominfo.com",
      "app.apollo.io",
      "rocketreach.co",
      "www.crunchbase.com",
      "LinkedIn.com.",
      "linkedin.com:443",
    ]) {
      expect(isDeniedHost(host), host).toBe(true);
    }
  });

  test("company sites and look-alikes are allowed", () => {
    for (const host of [
      "acme.com",
      "notlinkedin.com",
      "linkedin.company.io",
      "boards-api.greenhouse.io",
      "query.wikidata.org",
    ]) {
      expect(isDeniedHost(host), host).toBe(false);
    }
    expect(isDeniedUrl("https://www.linkedin.com/company/acme")).toBe(true);
    expect(isDeniedUrl("not a url")).toBe(true);
  });
});

test.describe("classification", () => {
  test("page kinds by path", () => {
    const k = (u: string) => kindForUrl(new URL(u));
    expect(k("https://acme.com/")).toBe("homepage");
    expect(k("https://acme.com/team")).toBe("team");
    expect(k("https://acme.com/about/leadership/")).toBe("team");
    expect(k("https://acme.com/about-us.html")).toBe("about");
    expect(k("https://acme.com/contact")).toBe("contact");
    expect(k("https://acme.com/careers")).toBe("careers");
    expect(k("https://acme.com/careers/engineer-1")).toBe("other");
    expect(k("https://acme.com/team?page=2")).toBe("other");
  });

  test("seniority and department from titles", () => {
    const cases: Array<[string, string | null, string | null]> = [
      ["Chief Executive Officer", "c_suite", "C-Suite"],
      ["Co-founder & CTO", "founder", "C-Suite"],
      ["VP Engineering", "vp", "Engineering & Technical"],
      ["Vice President, Sales", "vp", "Sales"],
      ["Head of Marketing", "head", "Marketing"],
      ["Director of Finance", "director", "Finance"],
      ["Engineering Manager", "manager", "Engineering & Technical"],
      ["Senior Software Engineer", "senior", "Engineering & Technical"],
      ["Product Designer", "entry", "Product"],
      ["Talent Acquisition Specialist", "entry", "Human Resources"],
      ["General Counsel", null, "Legal"],
      ["Marketing Intern", "intern", "Marketing"],
      ["", null, null],
    ];
    for (const [title, seniority, department] of cases) {
      expect(seniorityFromTitle(title), title).toBe(seniority);
      expect(departmentFromTitle(title), title).toBe(department);
    }
  });

  test("politeness floor, crawl-delay cap, back-off and re-crawl intervals", () => {
    expect(hostDelayMs(null)).toBe(2_000);
    expect(hostDelayMs(0.1)).toBe(2_000);
    expect(hostDelayMs(2.5)).toBe(2_500);
    expect(hostDelayMs(600)).toBe(60_000);
    expect(hostDelayMs(null, 500)).toBe(2_000);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(30)).toBe(24 * 60 * 60 * 1000);
    expect(recrawlIntervalMs("rss")).toBe(24 * 60 * 60 * 1000);
    expect(recrawlIntervalMs("team")).toBe(14 * 24 * 60 * 60 * 1000);
    expect(recrawlIntervalMs("homepage", { homepage: 3 })).toBe(3 * 24 * 60 * 60 * 1000);
  });

  test("company keys, employee ranges and opt-out keys", () => {
    expect(companyDomainFor(new URL("https://www.acme.co.uk/team"))).toBe("acme.co.uk");
    expect(companyDomainFor(new URL("http://nimbus-disco.localhost:48091/"))).toBe("nimbus-disco.localhost:48091");
    expect(employeeRangeFor(42)).toBe("21-50");
    expect(employeeRangeFor(25_000)).toBe("10001+");
    expect(employeeRangeFor(0)).toBeNull();
    expect(personOptoutKey("  Jane   Doe ", "www.Acme.com:8080")).toBe("jane doe|acme.com");
  });

  test("domain lists: any column, deduplicated per company, schemes kept", () => {
    const text =
      "rank,domain\n1,google.com\n2,www.google.com\n3,https://acme.co.uk/about\nnot a domain\nhttp://localhost.test:8080\n";
    expect(seedUrlsFromText(text)).toEqual([
      "https://google.com/",
      "https://acme.co.uk/",
      "http://localhost.test:8080/",
    ]);
  });
});

test.describe("job boards", () => {
  test("board links are detected; board pages are mapped to their public APIs", () => {
    expect(atsBoardFromUrl("https://boards.greenhouse.io/acme")).toEqual({ provider: "greenhouse", token: "acme" });
    expect(atsBoardFromUrl("https://boards.greenhouse.io/embed/job_board?for=Acme")).toEqual({
      provider: "greenhouse",
      token: "acme",
    });
    expect(atsBoardFromUrl("https://jobs.lever.co/acme/1234-abcd")).toEqual({ provider: "lever", token: "acme" });
    expect(atsBoardFromUrl("https://jobs.ashbyhq.com/acme")).toEqual({ provider: "ashby", token: "acme" });
    expect(atsBoardFromUrl("https://apply.workable.com/acme/")).toEqual({ provider: "workable", token: "acme" });
    expect(atsBoardFromUrl("https://acme.com/careers")).toBeNull();
    expect(
      detectAtsBoards([
        "https://jobs.lever.co/acme",
        "https://jobs.lever.co/acme/1",
        "https://boards.greenhouse.io/acme",
      ]),
    ).toHaveLength(2);

    expect(atsApiUrl({ provider: "greenhouse", token: "acme" })).toBe(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
    );
    expect(atsApiUrl({ provider: "lever", token: "acme" })).toBe("https://api.lever.co/v0/postings/acme?mode=json");
    expect(atsApiUrl({ provider: "ashby", token: "acme" })).toBe("https://api.ashbyhq.com/posting-api/job-board/acme");
    expect(atsApiUrl({ provider: "greenhouse", token: "acme" }, { greenhouse: "http://fixture.localhost:1/" })).toBe(
      "http://fixture.localhost:1/v1/boards/acme/jobs",
    );
    expect(atsBoardFromApiUrl("https://api.lever.co/v0/postings/acme?mode=json")).toEqual({
      provider: "lever",
      token: "acme",
    });
  });

  test("canned API responses parse into postings", () => {
    const greenhouse = parseAtsJobs(
      "greenhouse",
      JSON.stringify({
        jobs: [
          {
            title: "Data Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            location: { name: "Berlin" },
            updated_at: "2026-10-01T00:00:00Z",
            departments: [{ name: "Data" }],
          },
          { title: "No URL" },
          { title: "Data Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/1" },
        ],
      }),
    );
    expect(greenhouse).toHaveLength(1);
    expect(greenhouse[0]).toMatchObject({ title: "Data Engineer", department: "Data", location: "Berlin" });
    expect(greenhouse[0]?.postedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");

    const lever = parseAtsJobs(
      "lever",
      JSON.stringify([
        {
          text: "Account Executive",
          hostedUrl: "https://jobs.lever.co/acme/1",
          categories: { location: "NYC" },
          createdAt: 1_790_000_000_000,
        },
      ]),
    );
    expect(lever[0]).toMatchObject({ title: "Account Executive", department: "Sales", location: "NYC" });

    const ashby = parseAtsJobs(
      "ashby",
      JSON.stringify({
        jobs: [
          {
            title: "Designer",
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            department: "Design",
            location: "Remote",
            publishedAt: "2026-09-01T00:00:00Z",
          },
          { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/2", isListed: false },
        ],
      }),
    );
    expect(ashby.map((j) => j.title)).toEqual(["Designer"]);

    const workable = parseAtsJobs(
      "workable",
      JSON.stringify({
        jobs: [
          { title: "Support Specialist", url: "https://apply.workable.com/j/1", city: "Lisbon", country: "Portugal" },
        ],
      }),
    );
    expect(workable[0]?.location).toBe("Lisbon, Portugal");
    expect(parseAtsJobs("greenhouse", "<html>not json")).toEqual([]);
  });
});

test.describe("feeds and sitemaps", () => {
  test("RSS and Atom items, newest first, CDATA and entities decoded", () => {
    const rss = `<rss><channel><item><title><![CDATA[A & B]]></title><link>/news/a</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>Older &amp; wiser</title><link>https://acme.com/news/b</link><pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(rss, "https://acme.com/feed.xml").map((i) => [i.title, i.url])).toEqual([
      ["A & B", "https://acme.com/news/a"],
      ["Older & wiser", "https://acme.com/news/b"],
    ]);
    const atom = `<feed><entry><title>Launch</title><link rel="alternate" href="https://acme.com/launch"/><updated>2026-10-02T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, "https://acme.com/")).toEqual([
      { title: "Launch", url: "https://acme.com/launch", publishedAt: new Date("2026-10-02T00:00:00Z") },
    ]);
    expect(
      feedLinks(
        '<link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="/a.css">',
        "https://acme.com/",
      ),
    ).toEqual(["https://acme.com/feed.xml"]);
  });

  test("sitemaps and sitemap indexes", () => {
    expect(
      parseSitemap(
        "<urlset><url><loc>https://acme.com/team</loc></url><url><loc> /about </loc></url></urlset>",
        "https://acme.com/",
      ),
    ).toEqual({
      urls: ["https://acme.com/team", "https://acme.com/about"],
      sitemaps: [],
    });
    expect(
      parseSitemap(
        "<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>",
        "https://acme.com/",
      ).sitemaps,
    ).toEqual(["https://acme.com/s1.xml"]);
  });
});

test.describe("Wikidata", () => {
  test("the query takes validated item ids only, with LIMIT and OFFSET", () => {
    const query = buildWikidataQuery({ countries: ["Q16", "Q30; DROP"], industries: ["Q11661"] }, 200, 400);
    expect(query).toContain("VALUES ?country { wd:Q16 }");
    expect(query).not.toContain("DROP");
    expect(query).toContain("VALUES ?industry { wd:Q11661 }");
    // Direct instances, paged in a subquery: the subclass path and a global ORDER BY time out on
    // the public endpoint.
    expect(query).toContain("?item wdt:P31 ?type ; wdt:P856 ?website .");
    expect(query).not.toContain("wdt:P279*");
    expect(query).not.toContain("ORDER BY");
    expect(query).toMatch(/SELECT DISTINCT \?item WHERE \{[\s\S]*\}\n {4}LIMIT 200\n {4}OFFSET 400\n/);
    expect(buildWikidataQuery({}, 5000, -3)).toMatch(/LIMIT 1000\n {4}OFFSET 0\n/);
    expect(buildWikidataQuery({}, 10, 0)).not.toContain("wdt:P1128 [] .");
    expect(buildWikidataQuery({ requireHeadcount: true }, 10, 0)).toContain("wdt:P1128 [] .");
    const url = new URL(wikidataRequestUrl("https://query.wikidata.org/sparql", query));
    expect(url.searchParams.get("format")).toBe("json");
  });

  test("SPARQL results merge per item and drop rows without a website", () => {
    const body = {
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q1" },
            itemLabel: { value: "One" },
            website: { value: "https://one.example" },
            employees: { value: "50" },
            inception: { value: "1999-05-01T00:00:00Z" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q1" },
            itemLabel: { value: "One" },
            website: { value: "https://one.example/other" },
            countryLabel: { value: "France" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q2" },
            itemLabel: { value: "Q2" },
            website: { value: "ftp://two.example" },
          },
        ],
      },
    };
    const { rows, count, items } = parseWikidataResults(JSON.stringify(body));
    expect(count).toBe(3);
    expect(items).toBe(2);
    expect(rows).toEqual([
      {
        qid: "Q1",
        name: "One",
        website: "https://one.example",
        country: "France",
        industry: null,
        employeeCount: 50,
        foundedYear: 1999,
        city: null,
      },
    ]);
    expect(parseWikidataResults("nope")).toEqual({ rows: [], count: 0, items: 0 });
  });
});

test.describe("real-web guards", () => {
  test("background workers leave local and reserved hosts alone", () => {
    for (const host of [
      "localhost",
      "localhost:48091",
      "nimbus-disco.localhost:48091",
      "127.0.0.1:3410",
      "[::1]:8080",
      "acme.test",
      "orbit.example",
      "x.invalid",
      "printer.local",
    ])
      expect(isReservedHost(host), host).toBe(true);
    for (const host of ["example.com", "www.stripe.com", "test.io", "localhost.company.com", "10.0.0.1"])
      expect(isReservedHost(host), host).toBe(false);
  });

  test("product, plan and logo headings are not people's names", () => {
    for (const name of ["Mary Major", "María José García", "Jean-Luc Picard", "J. R. Smith", "Mary O'Neil"])
      expect(plausiblePersonName(name), name).toBe(true);
    for (const name of ["The HubSpot Customer Platform", "Small Business Bundle", "Open AI", "Acme Labs", "Our Team"])
      expect(plausiblePersonName(name), name).toBe(false);
  });

  test("review authors, bylines and bare names outside team pages are not staff", () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;
    const html = [
      ld({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Painters Pro",
        founder: { "@type": "Person", name: "Matthew Lymer", jobTitle: "Founder" },
        review: [{ "@type": "Review", author: { "@type": "Person", name: "Felix Fischer" } }],
      }),
      ld({ "@type": "BlogPosting", headline: "Ten tips", author: { "@type": "Person", name: "Nora Writer" } }),
      ld({ "@type": "Person", name: "Bare Name" }),
      ld({ "@type": "Person", name: "Mark H.", jobTitle: "Customer" }),
    ].join("");
    const names = (path: string) => {
      const url = new URL(`https://painters.example${path}`);
      return extractPeople(html, jsonLdObjects(html), url)
        .map((p) => p.name)
        .sort();
    };
    expect(names("/")).toEqual(["Matthew Lymer"]);
    expect(names("/team")).toEqual(["Bare Name", "Matthew Lymer"]);
  });

  test("leadership titles in other languages", () => {
    expect(seniorityFromTitle("Gründer")).toBe("founder");
    expect(seniorityFromTitle("Mitgründerin & CTO")).toBe("founder");
    expect(seniorityFromTitle("Fondatrice")).toBe("founder");
    expect(seniorityFromTitle("Geschäftsführer")).toBe("c_suite");
    expect(seniorityFromTitle("Vorstandsvorsitzender VHV a.G.")).toBe("c_suite");
    expect(seniorityFromTitle("Directeur général")).toBe("c_suite");
    expect(departmentFromTitle("Fundadora")).toBe("C-Suite");
    expect(seniorityFromTitle("Gründungsberater")).toBeNull();
    expect(seniorityFromTitle("Dirigeant")).toBe("c_suite");
    expect(seniorityFromTitle("Senior Executive Assistant to the CEO")).toBe("senior");
    expect(seniorityFromTitle("Former CFO, Atlassian")).toBeNull();
    expect(departmentFromTitle("Former CFO, Atlassian")).toBeNull();
    expect(seniorityFromTitle("Chief Financial Officer")).toBe("c_suite");
  });

  test("translated copies of a page are not followed", () => {
    const here = new URL("https://acme.com/company");
    expect(isOtherLocale(new URL("https://acme.com/pt-br/company/management"), here)).toBe(true);
    expect(isOtherLocale(new URL("https://acme.com/de/team"), here)).toBe(true);
    expect(isOtherLocale(new URL("https://acme.com/en/team"), here)).toBe(false);
    expect(isOtherLocale(new URL("https://acme.com/team"), here)).toBe(false);
    expect(isOtherLocale(new URL("https://acme.com/us/about"), here)).toBe(false);
    expect(isOtherLocale(new URL("https://br.acme.com/company/management"), here)).toBe(true);
    expect(isOtherLocale(new URL("https://www.acme.com/company/management"), here)).toBe(false);
    // A German site's own pages are followed from a German page.
    expect(isOtherLocale(new URL("https://acme.de/de/team"), new URL("https://acme.de/de/"))).toBe(false);
  });

  test("company names from real homepage titles, countries from codes", () => {
    expect(companyNameFromTitle(null, "AI Innovation Workspace | Miro", "miro.com")).toBe("Miro");
    expect(companyNameFromTitle(null, "Elastic: The search database for AI", "elastic.co")).toBe("Elastic");
    expect(companyNameFromTitle(null, "Product Intelligence Platform for the AI Era", "mixpanel.com")).toBe(
      "Product Intelligence Platform for the AI Era",
    );
    expect(companyNameFromTitle("Mixpanel", "Product Intelligence Platform for the AI Era", "mixpanel.com")).toBe(
      "Mixpanel",
    );
    expect(companyNameFromTitle(null, "| Forlagshuset Lunde", "forlagshusetlunde.no")).toBe("Forlagshuset Lunde");
    expect(companyNameFromTitle(null, "Startseite", "brbag.de")).toBeNull();
    expect(companyNameFromTitle(null, "Hjem - Arkiv Finnmark", "arkivfinnmark.no")).toBe("Arkiv Finnmark");
    expect(countryName("US")).toBe("United States");
    expect(countryName("USA")).toBe("United States");
    expect(countryName("gb")).toBe("United Kingdom");
    expect(countryName("Canada")).toBe("Canada");
    expect(countryName("Usa")).toBe("Usa");
    expect(countryName("")).toBeNull();
  });
});
