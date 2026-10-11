import "server-only";

import { asc, eq } from "drizzle-orm";

import { can } from "@/lib/rbac/permissions";
import type { Segment } from "@/lib/search/filters";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";
import { pageFrom } from "@/server/http/route";

import { type CompanyDto, searchCompanies } from "./companies";
import { type ContactDto, searchContacts } from "./contacts";
import { listCustomFields } from "./custom-fields";
import { listLists } from "./lists";
import { listPersonas } from "./personas";
import { workspaceMembers } from "./records";
import { getSavedSearch, listSavedSearches, type SavedSearchDto } from "./saved-searches";
import {
  type CompanyFilters,
  type Facets,
  type FilterContext,
  facetCounts,
  importBatchOptions,
  type PeopleFilters,
  type QuickFilters,
  quickFilters,
  resolveFilterContext,
  type SegmentCounts,
  safeParseFilters,
  segmentCounts,
} from "./search-filters";

/**
 * Everything a search screen (people, companies, saved records, a list) needs on first render,
 * from the URL's search parameters. Stale ids in the URL are dropped instead of failing the page.
 */

type Raw = Record<string, string | string[] | undefined>;
type Entity = "contact" | "company";

const REF_KEYS = ["listId", "listExclude", "ownerId", "sequenceId", "sequenceExclude", "personaId", "companyId"];

export interface SearchPageData {
  rows: ContactDto[] | CompanyDto[];
  pagination: { page: number; per_page: number; total_entries: number; total_pages: number };
  counts: SegmentCounts;
  facets: Facets;
  quick: QuickFilters;
  options: {
    members: { id: string; name: string }[];
    lists: { id: string; name: string }[];
    sequences: { id: string; name: string }[];
    personas: { id: string; name: string }[];
    customFields: {
      key: string;
      label: string;
      type: "text" | "number" | "date" | "boolean" | "picklist" | "url";
      options: string[];
    }[];
    importBatches: { id: string; name: string }[];
  };
  savedSearches: SavedSearchDto[];
  activeSavedSearch: SavedSearchDto | null;
  permissions: {
    create: boolean;
    update: boolean;
    companyUpdate: boolean;
    delete: boolean;
    import: boolean;
    export: boolean;
    enrich: boolean;
    listCreate: boolean;
    listUpdate: boolean;
    sequenceLaunch: boolean;
    saveSearch: boolean;
    workflowCreate: boolean;
    personaManage: boolean;
    aiUse: boolean;
  };
}

export function searchPermissions(actor: Actor, entity: Entity): SearchPageData["permissions"] {
  const r = actor.role;
  const p = entity === "contact" ? "contact" : "company";
  return {
    create: can(r, `${p}:create`),
    update: can(r, `${p}:update`),
    companyUpdate: can(r, "company:update"),
    delete: can(r, `${p}:delete`),
    import: can(r, `${p}:import`),
    export: can(r, `${p}:export`),
    enrich: can(r, "enrich:run"),
    listCreate: can(r, "list:create"),
    listUpdate: can(r, "list:update"),
    sequenceLaunch: can(r, "sequence:launch"),
    saveSearch: can(r, "savedsearch:create"),
    workflowCreate: can(r, "workflow:create"),
    personaManage: can(r, "persona:manage"),
    aiUse: can(r, "ai:use"),
  };
}

/** Option lists for the filter editors (owners, lists, sequences, personas, custom fields, imports). */
export async function searchOptions(actor: Actor, entity: Entity): Promise<SearchPageData["options"]> {
  const [members, lists, sequences, personas, customFields, importBatches] = await Promise.all([
    workspaceMembers(actor),
    listLists(actor, { entityType: entity }),
    can(actor.role, "sequence:read")
      ? db
          .select({ id: schema.sequence.id, name: schema.sequence.name })
          .from(schema.sequence)
          .where(eq(schema.sequence.organizationId, actor.organizationId))
          .orderBy(asc(schema.sequence.name))
      : Promise.resolve([]),
    entity === "contact" ? listPersonas(actor) : Promise.resolve([]),
    listCustomFields(actor, entity),
    importBatchOptions(actor, entity),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, name: m.name })),
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
    sequences,
    personas: personas.map((p) => ({ id: p.id, name: p.name })),
    customFields: customFields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options })),
    importBatches: importBatches.map((b) => ({ id: b.id, name: b.label })),
  };
}

export async function loadSearchPage(
  actor: Actor,
  entity: Entity,
  raw: Raw,
  opts: { fixed?: Record<string, string | string[]>; fixedSegment?: Segment } = {},
): Promise<SearchPageData> {
  const input: Record<string, unknown> = { ...raw, ...(opts.fixed ?? {}) };
  if (opts.fixedSegment) input.segment = opts.fixedSegment;
  let filters = safeParseFilters<PeopleFilters | CompanyFilters>(entity, input);
  let ctx: FilterContext;
  try {
    ctx = await resolveFilterContext(actor, entity, filters);
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error;
    const fixedKeys = Object.keys(opts.fixed ?? {});
    const cleaned = Object.fromEntries(
      Object.entries(input).filter(([k]) => !REF_KEYS.includes(k) || fixedKeys.includes(k)),
    );
    filters = safeParseFilters(entity, cleaned);
    ctx = await resolveFilterContext(actor, entity, filters);
  }
  const page = pageFrom(raw);
  const savedSearchId = typeof raw.savedSearchId === "string" ? raw.savedSearchId : null;

  const [result, counts, facets, quick, options, saved, active] = await Promise.all([
    entity === "contact"
      ? searchContacts(actor, filters as PeopleFilters, page).then((r) => ({
          rows: r.contacts,
          pagination: r.pagination,
        }))
      : searchCompanies(actor, filters as CompanyFilters, page).then((r) => ({
          rows: r.accounts,
          pagination: r.pagination,
        })),
    segmentCounts(entity, filters, ctx),
    facetCounts(entity, filters, ctx),
    quickFilters(actor, entity),
    searchOptions(actor, entity),
    listSavedSearches(actor, { entityType: entity }),
    savedSearchId ? getSavedSearch(actor, savedSearchId).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    rows: result.rows,
    pagination: result.pagination,
    counts,
    facets,
    quick,
    options,
    savedSearches: saved,
    activeSavedSearch: active && active.entityType === entity ? active : null,
    permissions: searchPermissions(actor, entity),
  };
}
