import type { FilterState, SearchEntity, Segment } from "@/lib/search/filters";

/** Client-side shapes passed from the search pages (server) to the search shell. */

export interface Option {
  id: string;
  name: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export type Facets = Record<string, FacetValue[]>;

export interface SegmentCounts {
  total: number;
  net_new: number;
  saved: number;
}

export interface CustomFieldOption {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "picklist" | "url";
  options: string[];
}

export interface SearchOptions {
  members: Option[];
  lists: Option[];
  sequences: Option[];
  personas: Option[];
  customFields: CustomFieldOption[];
  importBatches: Option[];
}

export interface SavedSearchItem {
  id: string;
  name: string;
  entityType: SearchEntity;
  filters: Record<string, unknown>;
  columns: string[] | null;
  sort: { field: string; ascending: boolean } | null;
  starred: boolean;
  shared: boolean;
  alertsEnabled: boolean;
  isOwner: boolean;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  assignedToId: string | null;
  updatedAt: string;
}

export interface QuickFilterData {
  locations: FacetValue[];
  titles: FacetValue[];
  industries: FacetValue[];
  employeeRanges: FacetValue[];
}

export interface SearchPermissions {
  create: boolean;
  update: boolean;
  /** company:update (saving a company from the drawer on the people screen). */
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
}

export interface Pagination {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

export interface SearchContext {
  entity: SearchEntity;
  basePath: string;
  /** Filters the page fixes (list page: listId; saved records: segment) — not shown as removable. */
  fixed: FilterState;
  fixedSegment?: Segment;
  currentUserId: string;
}
