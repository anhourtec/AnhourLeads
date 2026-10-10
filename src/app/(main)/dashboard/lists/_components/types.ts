import type { ListView } from "@/server/services/lists";

export type ListRow = ListView;

export interface ListPermissions {
  create: boolean;
  update: boolean;
  remove: boolean;
}

export const ENTITY_LABELS = { contact: "People", company: "Companies" } as const;
