import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAsRole } from "../support/session";
import { EVIL_ORIGIN, freshWorkspace, globexApi } from "./admin-helpers";

test.describe.configure({ timeout: 240_000 });

interface StageRow {
  key: string;
  label: string;
  position: number;
  protected: boolean;
}

const CONTACT_KEYS = [
  "new",
  "contacted",
  "replied",
  "interested",
  "not_interested",
  "unresponsive",
  "do_not_contact",
  "bad_data",
  "changed_job",
];

test.describe("record stages API", () => {
  test("read: every role; defaults seeded with labels and protection", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      for (const entityType of ["contact", "company"]) {
        const res = await api.get(`/api/v1/record_stages?entityType=${entityType}`);
        expect(res.status(), `${role} ${entityType}`).toBe(expected(role, "contact:read"));
      }
    }
    const ws = await freshWorkspace();
    const stages = (await (await ws.api.get("/api/v1/record_stages")).json()).stages as StageRow[];
    expect(stages.map((s) => s.key)).toEqual(CONTACT_KEYS);
    expect(stages.map((s) => s.label)).toEqual([
      "Cold",
      "Approaching",
      "Replied",
      "Interested",
      "Not interested",
      "Unresponsive",
      "Do not contact",
      "Bad data",
      "Changed job",
    ]);
    expect(stages.filter((s) => s.protected).map((s) => s.key)).toEqual([
      "interested",
      "not_interested",
      "do_not_contact",
      "changed_job",
    ]);
    const companies = (await (await ws.api.get("/api/v1/record_stages?entityType=company")).json())
      .stages as StageRow[];
    expect(companies.map((s) => s.key)).toEqual(["cold", "prospect", "engaged", "customer", "churned"]);
    expect((await (await anonymous()).get("/api/v1/record_stages")).status()).toBe(401);
  });

  test("write: every role per matrix (unchanged payload in the shared workspace)", async () => {
    const current = (await (await (await apiAsRole("owner")).get("/api/v1/record_stages")).json()).stages as StageRow[];
    const payload = {
      entityType: "contact",
      stages: current.map(({ key, label, protected: p }) => ({ key, label, protected: p })),
    };
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).put("/api/v1/record_stages", { data: payload });
      expect(res.status(), role).toBe(expected(role, "stage:manage"));
    }
    const owner = await apiAsRole("owner");
    expect((await owner.put("/api/v1/record_stages", { headers: EVIL_ORIGIN, data: payload })).status()).toBe(403);
    expect((await (await anonymous()).put("/api/v1/record_stages", { data: payload })).status()).toBe(401);
  });

  test("rename, reorder and protect; contact_stages shows the workspace labels; other workspaces unaffected", async () => {
    const ws = await freshWorkspace();
    const stages = (await (await ws.api.get("/api/v1/record_stages")).json()).stages as StageRow[];
    const renamed = stages.map((s) => ({
      key: s.key,
      label: s.key === "new" ? "Fresh lead" : s.label,
      protected: s.key === "replied" ? true : s.protected,
    }));
    const [first, second, ...rest] = renamed;
    const res = await ws.api.put("/api/v1/record_stages", { data: { stages: [second, first, ...rest] } });
    expect(res.status(), await res.text()).toBe(200);
    const updated = (await res.json()).stages as StageRow[];
    expect(updated[0].key).toBe("contacted");
    expect(updated[1]).toMatchObject({ key: "new", label: "Fresh lead" });
    expect(updated.find((s) => s.key === "replied")?.protected).toBe(true);

    const apollo = (await (await ws.api.get("/api/v1/contact_stages")).json()).contact_stages as {
      id: string;
      displayName: string;
      displayOrder: number;
    }[];
    expect(apollo.find((s) => s.id === "new")).toMatchObject({ displayName: "Fresh lead", displayOrder: 2 });

    const company = await ws.api.put("/api/v1/record_stages", {
      data: {
        entityType: "company",
        stages: [
          { key: "cold", label: "Not started" },
          { key: "prospect", label: "Prospect" },
          { key: "engaged", label: "Engaged" },
          { key: "customer", label: "Current client" },
          { key: "churned", label: "Churned" },
        ],
      },
    });
    expect(company.status(), await company.text()).toBe(200);
    const accounts = (await (await ws.api.get("/api/v1/account_stages")).json()).account_stages as {
      id: string;
      displayName: string;
    }[];
    expect(accounts.find((s) => s.id === "customer")?.displayName).toBe("Current client");

    const globex = (await (await (await globexApi()).get("/api/v1/contact_stages")).json()).contact_stages as {
      id: string;
      displayName: string;
    }[];
    expect(globex.find((s) => s.id === "new")?.displayName).toBe("Cold");
  });

  test("validation: every key exactly once, known keys only, distinct labels", async () => {
    const ws = await freshWorkspace();
    const stages = ((await (await ws.api.get("/api/v1/record_stages")).json()).stages as StageRow[]).map(
      ({ key, label, protected: p }) => ({ key, label, protected: p }),
    );
    const cases = [
      stages.slice(1),
      [...stages, { key: "custom_stage", label: "Custom", protected: false }],
      [...stages.slice(0, -1), { ...stages[0] }],
      stages.map((s, i) => (i === 1 ? { ...s, label: stages[0].label } : s)),
      stages.map((s, i) => (i === 0 ? { ...s, label: "" } : s)),
    ];
    for (const c of cases) {
      expect((await ws.api.put("/api/v1/record_stages", { data: { stages: c } })).status()).toBe(422);
    }
    expect((await ws.api.put("/api/v1/record_stages", { data: { entityType: "deal", stages } })).status()).toBe(422);
  });
});
