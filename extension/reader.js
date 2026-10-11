/**
 * @typedef {object} PersonDraft
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} title
 * @property {string} companyName
 * @property {string} companyDomain
 * @property {string} location
 * @property {string} linkedinUrl
 * @property {string} email
 * @property {string} pageUrl
 * @property {"json-ld" | "microdata" | "linkedin" | "opengraph"} via
 */

/**
 * Read the one person the visible page is about, or null.
 *
 * Runs inside the user's tab, injected by the popup with chrome.scripting.executeScript, so it must
 * stay self-contained: every helper lives inside this function and nothing outside it is referenced.
 * It only reads the DOM that is already loaded. It never scrolls, clicks, follows links or calls any
 * API, and it returns at most one person: pages that describe several people (team pages without a
 * main person, search results) return null.
 *
 * Order: JSON-LD, then schema.org microdata, then LinkedIn profile pages (linkedin.com/in/*), then
 * OpenGraph profile tags.
 *
 * @param {Document} [doc]
 * @param {{ href: string }} [loc]
 * @returns {PersonDraft | null}
 */
export function readPerson(doc = document, loc = location) {
  /** @param {unknown} v */
  const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  /** @param {unknown} v @returns {unknown[]} */
  const list = (v) => {
    if (Array.isArray(v)) return v;
    return v === undefined || v === null ? [] : [v];
  };
  /** @param {unknown} v @returns {Record<string, unknown> | null} */
  const obj = (v) =>
    v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
  /** @param {unknown} node @param {string} type */
  const isType = (node, type) =>
    list(obj(node)?.["@type"]).some((t) => typeof t === "string" && t.replace(/^.*[/#:]/, "") === type);

  let pageUrl;
  try {
    pageUrl = new URL(loc.href);
  } catch {
    return null;
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return null;
  const host = pageUrl.hostname.toLowerCase().replace(/^www\./, "");
  const onLinkedin = host === "linkedin.com" || host.endsWith(".linkedin.com");
  const profileMatch = pageUrl.pathname.match(/^\/in\/([^/?#]+)\/?/);
  // On LinkedIn only a single profile page is read: never search results, feeds, companies or lists.
  if (onLinkedin && !profileMatch) return null;

  /** @param {string} href */
  const linkedinProfile = (href) => {
    try {
      const u = new URL(href, pageUrl);
      const h = u.hostname.toLowerCase();
      const m = u.pathname.match(/^\/in\/([^/?#]+)/);
      if (!m || !(h === "linkedin.com" || h.endsWith(".linkedin.com"))) return "";
      return `https://www.linkedin.com/in/${m[1]}`;
    } catch {
      return "";
    }
  };
  /** @param {string} href */
  const domainOf = (href) => {
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      const h = u.hostname.toLowerCase().replace(/^www\./, "");
      return h === "linkedin.com" || h.endsWith(".linkedin.com") ? "" : h;
    } catch {
      return "";
    }
  };
  /** @param {string} value */
  const plainEmail = (value) => {
    const email = clean(value)
      .replace(/^mailto:/i, "")
      .split("?")[0];
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : "";
  };
  /** @param {string} name */
  const splitName = (name) => {
    const words = clean(name)
      .replace(/,.*$/, "")
      .replace(/\([^)]*\)/g, "")
      .split(" ")
      .filter(Boolean);
    if (words.length === 0) return { firstName: "", lastName: "" };
    if (words.length === 1) return { firstName: words[0], lastName: "" };
    return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
  };
  /** One distinct value or "" (several distinct values mean the page isn't about one person). */
  const single = (/** @type {string[]} */ values) => {
    const set = [...new Set(values.filter(Boolean))];
    return set.length === 1 ? set[0] : "";
  };
  const meta = (/** @type {string} */ key) =>
    clean(doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute("content"));
  /** @param {unknown} address */
  const placeText = (address) => {
    const a = obj(address);
    if (!a) return clean(address);
    const country = obj(a.addressCountry) ? clean(obj(a.addressCountry)?.name) : clean(a.addressCountry);
    return [clean(a.addressLocality), clean(a.addressRegion), country].filter(Boolean).join(", ");
  };

  /** @param {Partial<PersonDraft>} p @param {PersonDraft["via"]} via @returns {PersonDraft | null} */
  const finish = (p, via) => {
    const person = {
      firstName: clean(p.firstName),
      lastName: clean(p.lastName),
      title: clean(p.title).slice(0, 200),
      companyName: clean(p.companyName).slice(0, 200),
      companyDomain: clean(p.companyDomain),
      location: clean(p.location).slice(0, 200),
      linkedinUrl: clean(p.linkedinUrl),
      email: clean(p.email),
      pageUrl: pageUrl.href,
      via,
    };
    return person.firstName || person.lastName ? person : null;
  };

  /* 1. JSON-LD ------------------------------------------------------------ */
  /** @type {Record<string, unknown>[]} */
  const nodes = [];
  /** @param {unknown} value @param {number} depth */
  const walk = (value, depth) => {
    if (depth > 6) return;
    for (const item of list(value)) {
      const o = obj(item);
      if (!o) continue;
      nodes.push(o);
      for (const key of [
        "@graph",
        "mainEntity",
        "about",
        "author",
        "employee",
        "member",
        "founder",
        "itemListElement",
        "item",
      ]) {
        if (o[key] !== undefined) walk(o[key], depth + 1);
      }
    }
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(script.textContent ?? ""), 0);
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  }
  const people = [...new Set(nodes.filter((n) => isType(n, "Person")))];
  const profilePage = nodes.find((n) => isType(n, "ProfilePage"));
  const mainEntity = profilePage
    ? list(profilePage.mainEntity)
        .map(obj)
        .find((n) => n && isType(n, "Person"))
    : null;
  const ldPerson = mainEntity ?? (people.length === 1 ? people[0] : null);
  if (ldPerson) {
    const org = list(ldPerson.worksFor).map(obj).find(Boolean) ?? null;
    const split = splitName(clean(ldPerson.name));
    const sameAs = list(ldPerson.sameAs).map((s) => linkedinProfile(clean(s)));
    const draft = finish(
      {
        firstName: clean(ldPerson.givenName) || split.firstName,
        lastName: clean(ldPerson.familyName) || split.lastName,
        title: clean(ldPerson.jobTitle),
        companyName: org ? clean(org.name) : clean(ldPerson.worksFor),
        companyDomain: org ? domainOf(clean(org.url)) : "",
        location: placeText(ldPerson.address ?? ldPerson.workLocation ?? ldPerson.homeLocation),
        linkedinUrl: (onLinkedin && profileMatch ? linkedinProfile(pageUrl.href) : "") || single(sameAs),
        email: plainEmail(clean(ldPerson.email)),
      },
      "json-ld",
    );
    if (draft) return draft;
  }
  // Several people and no main one: a team or listing page. Never pick one at random.
  if (people.length > 1) return null;

  /* 2. Microdata ----------------------------------------------------------- */
  const scopes = [...doc.querySelectorAll("[itemscope][itemtype]")].filter((el) =>
    /schema\.org\/Person$/i.test(el.getAttribute("itemtype") ?? ""),
  );
  if (scopes.length > 1) return null;
  if (scopes.length === 1) {
    const scope = scopes[0];
    /** @param {string} prop */
    const prop = (prop) => {
      const el = [...scope.querySelectorAll(`[itemprop="${prop}"]`)].find(
        (e) => e.closest("[itemscope]") === scope || e.parentElement?.closest("[itemscope]") === scope,
      );
      if (!el) return "";
      return clean(el.getAttribute("content") ?? el.getAttribute("href") ?? el.textContent);
    };
    const orgEl = scope.querySelector('[itemprop="worksFor"]');
    const split = splitName(prop("name"));
    const draft = finish(
      {
        firstName: prop("givenName") || split.firstName,
        lastName: prop("familyName") || split.lastName,
        title: prop("jobTitle"),
        companyName: clean(orgEl?.querySelector('[itemprop="name"]')?.textContent ?? orgEl?.textContent),
        location: prop("addressLocality") || prop("address"),
        linkedinUrl: single(
          [...scope.querySelectorAll('a[href*="linkedin.com/in/"]')].map((a) =>
            linkedinProfile(a.getAttribute("href") ?? ""),
          ),
        ),
        email: plainEmail(prop("email")),
      },
      "microdata",
    );
    if (draft) return draft;
  }

  /* 3. LinkedIn profile page (linkedin.com/in/<slug>) ----------------------- */
  if (onLinkedin && profileMatch) {
    const root = doc.querySelector("main") ?? doc.body;
    const h1s = [...root.querySelectorAll("h1")].filter((h) => clean(h.textContent));
    if (h1s.length !== 1) return null;
    const h1 = h1s[0];
    const card = h1.closest("section") ?? h1.parentElement?.parentElement ?? root;
    const texts = (/** @type {string} */ selector) =>
      [...card.querySelectorAll(selector)].map((e) => clean(e.textContent)).filter(Boolean);
    const headline = texts(".text-body-medium")[0] ?? "";
    const place =
      texts(".text-body-small.inline, .text-body-small").find((t) => !/contact info|connections|followers/i.test(t)) ??
      "";
    const companyLabel = clean(
      card.querySelector('[aria-label^="Current company"]')?.getAttribute("aria-label") ??
        card.querySelector('[aria-label^="Current company"]')?.textContent,
    );
    const company =
      companyLabel.replace(/^Current company:\s*/i, "").replace(/\.\s*Click.*$/i, "") ||
      (headline.match(/\s(?:at|@)\s+(.+)$/i)?.[1] ?? "");
    const title = headline.replace(/\s(?:at|@)\s+.+$/i, "");
    const split = splitName(h1.textContent ?? "");
    return finish(
      {
        firstName: split.firstName,
        lastName: split.lastName,
        title: title.split(/\s[|·]\s/)[0],
        companyName: company,
        location: place,
        linkedinUrl: linkedinProfile(pageUrl.href),
        email: single(
          [...card.querySelectorAll('a[href^="mailto:"]')].map((a) => plainEmail(a.getAttribute("href") ?? "")),
        ),
      },
      "linkedin",
    );
  }

  /* 4. OpenGraph profile --------------------------------------------------- */
  if (meta("og:type").toLowerCase() === "profile") {
    const split = splitName(meta("og:title").split(/\s[-|–]\s/)[0]);
    return finish(
      {
        firstName: meta("profile:first_name") || split.firstName,
        lastName: meta("profile:last_name") || split.lastName,
        linkedinUrl: single(
          [...doc.querySelectorAll('a[href*="linkedin.com/in/"]')].map((a) =>
            linkedinProfile(a.getAttribute("href") ?? ""),
          ),
        ),
      },
      "opengraph",
    );
  }
  return null;
}
