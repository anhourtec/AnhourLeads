import { expect, test } from "@playwright/test";

import {
  decodeCloudflareEmail,
  deobfuscate,
  extractPage,
  socialProfile,
  splitName,
} from "../../src/server/crawler/extract";
import { classifyIp, isPublicIp } from "../../src/server/crawler/ip";
import { isAllowed, parseRobots, productToken } from "../../src/server/crawler/robots";
import { domainFromInput, normalizeUrl, pagePriority, registrableDomain, sameSite } from "../../src/server/crawler/url";
import { isDisposableDomain } from "../../src/server/email/disposable-domains";
import { detectPattern, generateCandidates, patternsFor, renderPattern } from "../../src/server/email/patterns";
import { checkSyntax, classify, isRoleAddress } from "../../src/server/email/verify-rules";

/** Pure functions behind the crawler and verification, tested without HTTP. */

test.describe("SSRF guard: IP classifier", () => {
  const cases: Array<[string, string]> = [
    ["8.8.8.8", "public"],
    ["93.184.216.34", "public"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["127.0.0.1", "loopback"],
    ["127.255.0.9", "loopback"],
    ["169.254.169.254", "link_local"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.254", "cgnat"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.251", "multicast"],
    ["239.255.255.250", "multicast"],
    ["255.255.255.255", "reserved"],
    ["198.18.0.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link_local"],
    ["fe80::1%en0", "link_local"],
    ["fc00::1", "private"],
    ["fd12:3456::1", "private"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:169.254.169.254", "link_local"],
    ["::ffff:7f00:1", "loopback"],
    ["64:ff9b::a9fe:a9fe", "link_local"],
    ["2002:7f00:1::", "loopback"],
    ["2001:db8::1", "reserved"],
    ["[::1]", "loopback"],
    ["2606:4700:4700::1111", "public"],
    ["not-an-ip", "invalid"],
    ["999.1.1.1", "invalid"],
  ];
  for (const [ip, expectedClass] of cases) {
    test(`${ip} → ${expectedClass}`, () => {
      expect(classifyIp(ip)).toBe(expectedClass);
    });
  }

  test("only public addresses pass", () => {
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("169.254.169.254")).toBe(false);
  });
});

test.describe("robots.txt", () => {
  const ua = "AnhourLeadsBot/0.1 (+https://example.com/bot)";

  test("product token", () => {
    expect(productToken(ua)).toBe("anhourleadsbot");
  });

  test("falls back to the * group, longest match wins, Allow wins ties", () => {
    const policy = parseRobots(
      ["User-agent: *", "Disallow: /private", "Allow: /private/press", "Disallow: /*.pdf$", "Crawl-delay: 2"].join(
        "\n",
      ),
      ua,
    );
    expect(policy.matchedAgent).toBe("*");
    expect(policy.crawlDelaySeconds).toBe(2);
    expect(isAllowed(policy, "/")).toBe(true);
    expect(isAllowed(policy, "/private")).toBe(false);
    expect(isAllowed(policy, "/private/admin")).toBe(false);
    expect(isAllowed(policy, "/private/press-kit.html")).toBe(true);
    expect(isAllowed(policy, "/files/a.pdf")).toBe(false);
    expect(isAllowed(policy, "/files/a.pdf?x=1")).toBe(true);
    expect(isAllowed(policy, "/robots.txt")).toBe(true);

    const tie = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page", ua);
    expect(isAllowed(tie, "/page")).toBe(true);
  });

  test("a group naming our bot replaces the * group", () => {
    const text = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: OtherBot",
      "User-agent: AnhourLeadsBot",
      "Disallow: /admin # comment",
      "Crawl-delay: 5",
    ].join("\r\n");
    const policy = parseRobots(text, ua);
    expect(policy.matchedAgent).toBe("anhourleadsbot");
    expect(isAllowed(policy, "/about")).toBe(true);
    expect(isAllowed(policy, "/admin/users")).toBe(false);
    expect(policy.crawlDelaySeconds).toBe(5);
  });

  test("empty Disallow allows everything; wildcards and percent-encoding", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:", ua), "/anything")).toBe(true);
    const policy = parseRobots("User-agent: *\nDisallow: /*/secret\nDisallow: /a%7eb", ua);
    expect(isAllowed(policy, "/x/y/secret")).toBe(false);
    expect(isAllowed(policy, "/a~b")).toBe(false);
    expect(isAllowed(policy, "/public")).toBe(true);
  });

  test("no matching group means no rules", () => {
    expect(isAllowed(parseRobots("User-agent: SomeBot\nDisallow: /", ua), "/x")).toBe(true);
  });
});

test.describe("URLs", () => {
  test("registrable domain and same-site", () => {
    expect(registrableDomain("www.app.acme.com")).toBe("acme.com");
    expect(registrableDomain("shop.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(sameSite("https://www.acme.com/a", "http://blog.acme.com/")).toBe(true);
    expect(sameSite("https://acme.com", "https://acme.co")).toBe(false);
  });

  test("normalisation refuses non-http schemes and credentials", () => {
    expect(normalizeUrl("mailto:a@b.co")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("https://user:pass@acme.com/")).toBeNull();
    expect(normalizeUrl("HTTPS://ACME.com:443/a#frag")?.toString()).toBe("https://acme.com/a");
    expect(domainFromInput("https://www.Acme.com/about")).toBe("acme.com");
    expect(domainFromInput("nonsense")).toBeNull();
  });

  test("key pages are prioritised", () => {
    const p = (path: string) => pagePriority(new URL(path, "https://acme.com"));
    expect(p("/about")).toBeGreaterThan(p("/blog/some-post"));
    expect(p("/team")).toBeGreaterThan(p("/pricing"));
    expect(p("/careers")).toBeGreaterThan(p("/legal/terms"));
  });
});

test.describe("extraction", () => {
  test("deobfuscates emails", () => {
    expect(deobfuscate("jane [at] acme [dot] com")).toBe("jane@acme.com");
    expect(deobfuscate("jane(at)acme.com")).toBe("jane@acme.com");
    expect(deobfuscate("write to jane at acme dot com today")).toContain("jane@acme.com");
    expect(decodeCloudflareEmail(cfEncode("jane@acme.com"))).toBe("jane@acme.com");
    expect(decodeCloudflareEmail("zz")).toBeNull();
  });

  test("company social profiles only", () => {
    expect(socialProfile("https://www.linkedin.com/company/acme/about/")?.url).toBe(
      "https://www.linkedin.com/company/acme",
    );
    expect(socialProfile("https://twitter.com/acme")?.url).toBe("https://x.com/acme");
    expect(socialProfile("https://twitter.com/intent/tweet")).toBeNull();
    expect(socialProfile("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(socialProfile("https://github.com/acme")?.network).toBe("github");
    expect(socialProfile("https://github.com/features")).toBeNull();
  });

  test("names", () => {
    expect(splitName("Jane Doe")).toMatchObject({ firstName: "Jane", lastName: "Doe" });
    expect(splitName("María José García")).toMatchObject({ firstName: "María", lastName: "García" });
    expect(splitName("Our Values")).not.toBeNull(); // shape alone is ambiguous; card parsing also needs a title
    expect(splitName("Head of Sales")).toBeNull();
    expect(splitName("jane")).toBeNull();
    expect(splitName("Call 555 0100")).toBeNull();
  });

  test("a page: title, emails, phones, technologies, people, hiring", () => {
    const html = `<!doctype html><html><head>
      <title>Acme &amp; Co</title>
      <meta name="description" content="We make things.">
      <meta name="generator" content="Webflow">
      <script src="https://js.hs-scripts.com/123.js"></script>
      <script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme","foundingDate":"2012"},
        {"@type":"Person","name":"Ada Lovelace","jobTitle":"CTO","email":"ada@acme.com"},
        {"@type":"JobPosting","title":"Engineer"},{"@type":"JobPosting","title":"Designer"}]}</script>
      <script>var x = "hidden@acme.com";</script>
    </head><body>
      <a href="mailto:hello@acme.com?subject=Hi">Email</a>
      <p>Support: support (at) acme (dot) com</p>
      <a href="tel:+1-212-555-0199">Call</a>
      <img src="logo@2x.png">
      <span class="__cf_email__" data-cfemail="${cfEncode("press@acme.com")}">[email&#160;protected]</span>
      <p>&copy; 2014 Acme</p>
    </body></html>`;
    const page = extractPage(html, "https://acme.com/careers", { server: "cloudflare" });
    expect(page.title).toBe("Acme & Co");
    const emails = page.emails.map((e) => e.email);
    expect(emails).toEqual(
      expect.arrayContaining(["hello@acme.com", "support@acme.com", "press@acme.com", "ada@acme.com"]),
    );
    expect(emails).not.toContain("hidden@acme.com");
    expect(emails.some((e) => e.includes("logo"))).toBe(false);
    expect(page.phones[0]?.value).toBe("+1-212-555-0199");
    const tech = page.technologies.map((t) => t.name);
    expect(tech).toEqual(expect.arrayContaining(["Webflow", "HubSpot", "Cloudflare"]));
    expect(page.people[0]).toMatchObject({ name: "Ada Lovelace", title: "CTO", method: "json_ld" });
    expect(page.hiring.jobCount).toBe(2);
    expect(page.hiring.careersUrl).toBe("https://acme.com/careers");
    expect(page.facts.find((f) => f.field === "foundedYear")?.value).toBe("2012");
    expect(page.facts.find((f) => f.field === "copyrightYear")?.value).toBe("2014");
  });

  test("team-card markup on a team page", () => {
    const html = `<div class="card"><h3>Grace Hopper</h3><p>VP Engineering</p></div>
      <div class="card"><h3>Our Mission</h3><p>Ship good software.</p></div>
      <div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Alan Turing</span>
        <span itemprop="jobTitle">Chief Scientist</span></div>`;
    const people = extractPage(html, "https://acme.com/team").people;
    expect(people.map((p) => p.name).sort()).toEqual(["Alan Turing", "Grace Hopper"]);
    // Off team pages, card markup alone isn't trusted.
    expect(extractPage(html, "https://acme.com/blog/post").people.map((p) => p.name)).toEqual(["Alan Turing"]);
  });
});

function cfEncode(email: string): string {
  const key = 0x42;
  return key.toString(16) + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
}

test.describe("email patterns", () => {
  test("render and match", () => {
    expect(renderPattern("{first}.{last}", "José", "O'Brien")).toBe("jose.obrien");
    expect(renderPattern("{f}{last}", "Jane", "Doe")).toBe("jdoe");
    expect(renderPattern("{first}{l}", "Jane", "")).toBeNull();
    expect(patternsFor("jane.doe@acme.com", "Jane", "Doe")).toEqual(["{first}.{last}"]);
  });

  test("detects the dominant pattern", () => {
    const detected = detectPattern([
      { firstName: "Jane", lastName: "Doe", email: "jdoe@acme.com" },
      { firstName: "John", lastName: "Smith", email: "jsmith@acme.com" },
      { firstName: "Ada", lastName: "Lovelace", email: "ada.lovelace@acme.com" },
      { firstName: null, lastName: null, email: "info@acme.com" },
    ]);
    expect(detected?.pattern).toBe("{f}{last}");
    expect(detected?.matches).toBe(2);
    expect(detected?.total).toBe(3);
    expect(detected?.confidence).toBeGreaterThan(0.4);
    expect(detected?.confidence).toBeLessThan(1);
    expect(detectPattern([])).toBeNull();
  });

  test("first-name-only addresses", () => {
    const detected = detectPattern([
      { firstName: "Jane", lastName: "Doe", email: "jane@acme.com" },
      { firstName: "John", lastName: "Smith", email: "john@acme.com" },
    ]);
    expect(detected?.pattern).toBe("{first}");
  });

  test("candidates start with the known pattern", () => {
    const c = generateCandidates("Jane", "Doe", "acme.com", "{first}_{last}");
    expect(c[0]).toBe("jane_doe@acme.com");
    expect(c).toContain("jane.doe@acme.com");
    expect(new Set(c).size).toBe(c.length);
    expect(generateCandidates("Jane", "Doe", "acme.com")[0]).toBe("jane.doe@acme.com");
  });
});

test.describe("verification rules", () => {
  test("syntax", () => {
    expect(checkSyntax("Jane.Doe+tag@Acme.com").ok).toBe(true);
    expect(checkSyntax("Jane.Doe+tag@Acme.com").email).toBe("jane.doe+tag@acme.com");
    for (const bad of [
      "plain",
      "a@b",
      "a@@b.com",
      ".a@b.com",
      "a..b@b.com",
      "a@-b.com",
      "a@b.c0m",
      `${"x".repeat(65)}@b.com`,
    ]) {
      expect(checkSyntax(bad).ok, bad).toBe(false);
    }
  });

  test("role and disposable", () => {
    expect(isRoleAddress("info")).toBe(true);
    expect(isRoleAddress("sales+eu")).toBe(true);
    expect(isRoleAddress("no-reply")).toBe(true);
    expect(isRoleAddress("jane")).toBe(false);
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("eu.mailinator.com")).toBe(true);
    expect(isDisposableDomain("acme.com")).toBe(false);
  });

  test("classification order", () => {
    const ok = checkSyntax("jane@acme.com");
    const mx = { kind: "mx" as const, hosts: ["mx.acme.com"] };
    expect(classify({ syntax: checkSyntax("bad"), mail: null, probe: "skipped" }).status).toBe("invalid");
    expect(classify({ syntax: checkSyntax("x@mailinator.com"), mail: null, probe: "skipped" }).status).toBe(
      "disposable",
    );
    expect(classify({ syntax: ok, mail: { kind: "none" }, probe: "skipped" }).status).toBe("invalid");
    expect(classify({ syntax: ok, mail: { kind: "null_mx" }, probe: "skipped" }).status).toBe("invalid");
    expect(classify({ syntax: checkSyntax("info@acme.com"), mail: mx, probe: "skipped" }).status).toBe("role");
    expect(classify({ syntax: checkSyntax("info@acme.com"), mail: { kind: "none" }, probe: "skipped" }).status).toBe(
      "invalid",
    );
    expect(classify({ syntax: ok, mail: mx, probe: "skipped" })).toEqual({
      status: "unknown",
      reason: "mx_found_unconfirmed",
    });
    expect(classify({ syntax: ok, mail: { kind: "a_fallback", hosts: ["acme.com"] }, probe: "skipped" }).status).toBe(
      "unknown",
    );
    expect(classify({ syntax: ok, mail: mx, probe: "accepted" }).status).toBe("valid");
    expect(classify({ syntax: ok, mail: mx, probe: "rejected" }).status).toBe("invalid");
    expect(classify({ syntax: ok, mail: mx, probe: "catch_all" }).status).toBe("catch_all");
    expect(classify({ syntax: ok, mail: { kind: "error", code: "ETIMEOUT" }, probe: "skipped" }).status).toBe(
      "unknown",
    );
  });
});
