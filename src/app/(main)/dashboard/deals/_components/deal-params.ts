/** URL state of the deals screen, parsed the same way on the server and the client. */

export type DealSort = "created_at" | "close_date" | "amount";

export interface DealParams {
  tab: "overview" | "analytics";
  view: "kanban" | "table";
  /** A pipeline id, "all" (table only) or "" for the default pipeline. */
  pipeline: string;
  q: string;
  owners: string[];
  stages: string[];
  closeFrom: string;
  closeTo: string;
  amountMin: number | null;
  amountMax: number | null;
  company: string;
  sort: DealSort;
  filters: boolean;
  deal: string;
  /** Open the create form on arrival (from setup). */
  create: boolean;
  /** Prefill the create form with this person and their company (`?new=1&contactId=`). */
  contactId: string;
}

type Raw = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).slice(0, 200);
const list = (v: string | string[] | undefined): string[] =>
  one(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 30);
const num = (v: string | string[] | undefined): number | null => {
  const s = one(v);
  return /^\d+$/.test(s) ? Number(s) : null;
};
const date = (v: string | string[] | undefined): string => (/^\d{4}-\d{2}-\d{2}$/.test(one(v)) ? one(v) : "");

export function parseDealParams(raw: Raw): DealParams {
  const sort = one(raw.sort);
  return {
    tab: one(raw.tab) === "analytics" ? "analytics" : "overview",
    view: one(raw.viewMode) === "table" ? "table" : "kanban",
    pipeline: one(raw.pipeline),
    q: one(raw.q),
    owners: list(raw.owner),
    stages: list(raw.stage),
    closeFrom: date(raw.closeFrom),
    closeTo: date(raw.closeTo),
    amountMin: num(raw.amountMin),
    amountMax: num(raw.amountMax),
    company: one(raw.company),
    sort: sort === "close_date" || sort === "amount" ? sort : "created_at",
    filters: one(raw.filters) === "1",
    deal: one(raw.deal),
    create: one(raw.create) === "1" || one(raw.new) === "1",
    contactId: one(raw.contactId),
  };
}

export function activeFilterCount(p: DealParams): number {
  return [
    p.owners.length > 0,
    p.stages.length > 0,
    Boolean(p.closeFrom || p.closeTo),
    p.amountMin !== null || p.amountMax !== null,
    Boolean(p.company),
  ].filter(Boolean).length;
}
