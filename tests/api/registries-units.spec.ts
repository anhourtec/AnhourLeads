import { expect, test } from "@playwright/test";

import {
  buildRegistryWebsiteQuery,
  companiesHouseAuth,
  companiesHouseName,
  companiesHouseRoleTitle,
  matchKeyForCompanyName,
  normalizeCik,
  normalizeCompanyNumber,
  parseCompaniesHouseOfficers,
  parseCompaniesHouseProfile,
  parseOwnershipDocument,
  parseRegistryWebsites,
  parseSecSubmissions,
  parseSecTickers,
  properCompanyName,
  registryRequirement,
  secFilingIndexUrl,
  secOfficerTitle,
  secOwnerName,
} from "../../src/server/discovery/registries";

/** Pure helpers behind the Companies House and SEC EDGAR seed sources (no HTTP, no database). */

test.describe("registry names", () => {
  test("Companies House officer names become Forenames Surname in proper case", () => {
    expect(companiesHouseName("SMITH, John Michael")).toBe("John Michael Smith");
    expect(companiesHouseName("O'BRIEN, Dr Siobhan")).toBe("Siobhan O'Brien");
    expect(companiesHouseName("VAN DER BERG, Anna")).toBe("Anna van der Berg");
    expect(companiesHouseName("SMITH-JONES, Mary")).toBe("Mary Smith-Jones");
    expect(companiesHouseName("MCDONALD, Ewan")).toBe("Ewan McDonald");
    expect(companiesHouseName("DAVIES, Sir Robert")).toBe("Robert Davies");
    expect(companiesHouseName("  ")).toBeNull();
  });

  test("SEC filer names are LAST FIRST MIDDLE", () => {
    expect(secOwnerName("COOK TIMOTHY D")).toBe("Timothy D Cook");
    expect(secOwnerName("Newstead Jennifer")).toBe("Jennifer Newstead");
    expect(secOwnerName("SMITH JOHN JR")).toBe("John Smith Jr.");
    expect(secOwnerName("Levinson, Arthur D")).toBe("Arthur D Levinson");
    expect(secOwnerName("MADONNA")).toBeNull();
  });

  test("roles and titles are readable", () => {
    expect(companiesHouseRoleTitle("director")).toBe("Director");
    expect(companiesHouseRoleTitle("secretary")).toBe("Company Secretary");
    expect(companiesHouseRoleTitle("llp-member")).toBe("LLP Member");
    expect(companiesHouseRoleTitle("llp-designated-member")).toBe("LLP Designated Member");
    expect(companiesHouseRoleTitle("some-new-role")).toBe("Some new role");
    expect(secOfficerTitle("EVP, CHIEF FINANCIAL OFFICER")).toBe("EVP, Chief Financial Officer");
    expect(secOfficerTitle("SVP, GC and Government Affairs")).toBe("SVP, GC and Government Affairs");
    expect(secOfficerTitle("CEO")).toBe("CEO");
    expect(secOfficerTitle("See Remarks")).toBeNull();
  });

  test("company names: proper case and match keys", () => {
    expect(properCompanyName("NORTHWIND TRADING LIMITED")).toBe("Northwind Trading Limited");
    expect(properCompanyName("TESCO PLC")).toBe("Tesco PLC");
    expect(properCompanyName("Apple Inc.")).toBe("Apple Inc.");
    expect(matchKeyForCompanyName("Apple Inc.")).toBe("apple");
    expect(matchKeyForCompanyName("APPLE INC")).toBe("apple");
    expect(matchKeyForCompanyName("The Sage Group plc")).toBe("sage group");
    expect(matchKeyForCompanyName("Marks & Spencer Group P.L.C.")).toBe(
      matchKeyForCompanyName("Marks and Spencer Group"),
    );
  });
});

test.describe("registry ids", () => {
  test("Companies House numbers are padded; CIKs lose their leading zeros", () => {
    expect(normalizeCompanyNumber("617987")).toBe("00617987");
    expect(normalizeCompanyNumber("sc123456")).toBe("SC123456");
    expect(normalizeCompanyNumber("not a number")).toBeNull();
    expect(normalizeCik("0000320193")).toBe("320193");
    expect(normalizeCik(320193)).toBe("320193");
    expect(normalizeCik("0000000000")).toBeNull();
  });

  test("Wikidata registry → website query and parser", () => {
    const query = buildRegistryWebsiteQuery("sec_edgar", 2000, 4000);
    expect(query).toContain("wdt:P5531");
    expect(query).toContain("wdt:P856");
    expect(query).toMatch(/LIMIT 2000\s+OFFSET 4000/);
    expect(query).not.toContain("ORDER BY");
    const raw = JSON.stringify({
      results: {
        bindings: [
          {
            item: { value: "http://www.wikidata.org/entity/Q1" },
            id: { value: "617987" },
            website: { value: "http://hsbc.com/" },
            itemLabel: { value: "HSBC" },
          },
          {
            item: { value: "http://www.wikidata.org/entity/Q1" },
            id: { value: "617987" },
            website: { value: "https://www.hsbc.com/" },
          },
          { item: { value: "http://www.wikidata.org/entity/Q2" }, id: { value: "bad" }, website: { value: "x" } },
        ],
      },
    });
    const parsed = parseRegistryWebsites("companies_house", raw);
    expect(parsed.items).toBe(2);
    expect(parsed.rows).toEqual([{ id: "00617987", qid: "Q1", website: "https://www.hsbc.com/", label: "HSBC" }]);
    expect(parseRegistryWebsites("companies_house", "not json").rows).toEqual([]);
  });
});

test.describe("Companies House parsing", () => {
  const personal = {
    date_of_birth: { month: 4, year: 1970 },
    nationality: "British",
    country_of_residence: "England",
    occupation: "Director",
    address: { address_line_1: "1 Home Street", locality: "London" },
  };

  test("only current people are kept, with nothing but their name and role", () => {
    const raw = JSON.stringify({
      total_results: 5,
      items: [
        { name: "SMITH, John", officer_role: "director", ...personal },
        { name: "JONES, Former", officer_role: "director", resigned_on: "2019-01-01", ...personal },
        { name: "ACME SECRETARIES LIMITED", officer_role: "corporate-secretary" },
        { name: "NOMINEES, Corp", officer_role: "director", identification: { registration_number: "1" } },
        { name: "SMITH, John", officer_role: "secretary", ...personal },
      ],
    });
    const { officers, total, items } = parseCompaniesHouseOfficers(raw);
    expect(officers).toEqual([{ fullName: "John Smith", title: "Director" }]);
    expect(Object.keys(officers[0] ?? {}).sort()).toEqual(["fullName", "title"]);
    expect(JSON.stringify(officers)).not.toMatch(/1970|British|Home Street|England/);
    expect(total).toBe(5);
    expect(items).toBe(5);
  });

  test("profile: active flag, founding year and the registered office's town", () => {
    const p = parseCompaniesHouseProfile(
      JSON.stringify({
        company_name: "NORTHWIND TRADING LIMITED",
        company_number: "1234567",
        company_status: "active",
        date_of_creation: "1999-05-17",
        registered_office_address: { locality: "LONDON", country: "England" },
      }),
    );
    expect(p).toEqual({
      number: "01234567",
      name: "Northwind Trading Limited",
      active: true,
      foundedYear: 1999,
      city: "London",
      region: "England",
      country: "United Kingdom",
    });
    expect(
      parseCompaniesHouseProfile(JSON.stringify({ company_number: "1", company_status: "dissolved" }))?.active,
    ).toBe(false);
  });
});

test.describe("SEC EDGAR parsing", () => {
  test("tickers: one row per CIK in file order", () => {
    const rows = parseSecTickers(
      JSON.stringify({
        "1": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
        "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
        "2": { cik_str: 320193, ticker: "AAPL-X", title: "Apple Inc." },
      }),
    );
    expect(rows.map((r) => r.cik)).toEqual(["1045810", "320193"]);
  });

  test("submissions: facts and recent ownership filings only", () => {
    const since = "2025-01-01";
    const sub = parseSecSubmissions(
      JSON.stringify({
        cik: "0000320193",
        name: "Apple Inc.",
        sicDescription: "Electronic Computers",
        website: "apple.com",
        addresses: { business: { city: "CUPERTINO", stateOrCountry: "CA" } },
        filings: {
          recent: {
            accessionNumber: ["0001-26-000001", "0001140361-26-000002", "0001140361-24-000003", "0001140361-26-000004"],
            filingDate: ["2026-01-01", "2026-09-01", "2024-06-01", "2026-10-01"],
            form: ["4", "4", "4", "10-K"],
            primaryDocument: ["a.xml", "xslF345X06/form4.xml", "old.xml", "k.htm"],
          },
        },
      }),
      since,
    );
    expect(sub).toMatchObject({
      cik: "320193",
      name: "Apple Inc.",
      website: "https://apple.com",
      industry: "Electronic Computers",
      city: "Cupertino",
      region: "California",
      country: "United States",
    });
    expect(sub?.ownershipFilings).toEqual([
      { accession: "0001140361-26-000002", filedAt: "2026-09-01", form: "4", document: "form4.xml" },
    ]);
    expect(secFilingIndexUrl("https://www.sec.gov", "320193", "0001140361-26-000002")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000114036126000002/0001140361-26-000002-index.htm",
    );
  });

  test("ownership documents: officers and directors, never funds or addresses", () => {
    const xml = `<ownershipDocument>
      <reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE A</rptOwnerName></reportingOwnerId>
        <reportingOwnerAddress><rptOwnerStreet1>1 PRIVATE LANE</rptOwnerStreet1></reportingOwnerAddress>
        <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer>
        <officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship></reportingOwner>
      <reportingOwner><reportingOwnerId><rptOwnerName>ROE RICHARD</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isDirector>true</isDirector><isOfficer>false</isOfficer></reportingOwnerRelationship></reportingOwner>
      <reportingOwner><reportingOwnerId><rptOwnerName>BIG FUND LP</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isDirector>1</isDirector><isTenPercentOwner>1</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>
      <reportingOwner><reportingOwnerId><rptOwnerName>OWNER ONLY</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isTenPercentOwner>1</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>
    </ownershipDocument>`;
    expect(parseOwnershipDocument(xml)).toEqual([
      { fullName: "Jane A Doe", title: "Chief Financial Officer" },
      { fullName: "Richard Roe", title: "Director" },
    ]);
  });
});

test.describe("registry readiness", () => {
  test("SEC needs a User-Agent with a contact email", () => {
    expect(registryRequirement("sec_edgar", { allowPrivate: false })?.envVar).toBe("SEC_USER_AGENT");
    expect(registryRequirement("sec_edgar", { allowPrivate: false, secUserAgent: "AnhourLeads" })?.envVar).toBe(
      "SEC_USER_AGENT",
    );
    expect(registryRequirement("sec_edgar", { allowPrivate: false, secUserAgent: "AnhourLeads a@b.co" })).toBeNull();
    expect(registryRequirement("sec_edgar", { allowPrivate: false })?.message).toMatch(/User-Agent not set/);
  });

  test("Companies House needs an API key, sent as the basic-auth username", () => {
    expect(registryRequirement("companies_house", { allowPrivate: false })?.envVar).toBe("COMPANIES_HOUSE_API_KEY");
    expect(registryRequirement("companies_house", { allowPrivate: false, companiesHouseApiKey: "k" })).toBeNull();
    expect(companiesHouseAuth("abc")).toBe(`Basic ${Buffer.from("abc:").toString("base64")}`);
  });

  test("fixture endpoints skip the requirement only when private hosts are allowed", () => {
    expect(registryRequirement("companies_house", { allowPrivate: true }, true)).toBeNull();
    expect(registryRequirement("sec_edgar", { allowPrivate: true }, true)).toBeNull();
    expect(registryRequirement("companies_house", { allowPrivate: false }, true)).not.toBeNull();
    expect(registryRequirement("sec_edgar", { allowPrivate: true }, false)).not.toBeNull();
  });
});
