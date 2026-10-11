import type { ListView } from "@/server/services/lists";

import type { SearchOptions, SearchPermissions } from "../../_components/records/search/types";

export type ListRow = ListView & { ownerName: string | null };

export interface ListPermissions {
  create: boolean;
  update: boolean;
  remove: boolean;
}

export const ENTITY_LABELS = { contact: "People", company: "Companies" } as const;

/** What the New list drawer needs to pick filters for either record type. */
export interface FilterPickerData {
  contact: { options: SearchOptions; permissions: SearchPermissions };
  company: { options: SearchOptions; permissions: SearchPermissions };
}
