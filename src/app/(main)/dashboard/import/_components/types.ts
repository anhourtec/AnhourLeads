export type ImportEntityKey = "contacts" | "accounts";

export interface ImportPermissions {
  contacts: boolean;
  accounts: boolean;
  enrich: boolean;
  createList: boolean;
  updateList: boolean;
}

export interface ListOption {
  id: string;
  name: string;
  entityType: "contact" | "company";
}

export interface PreviewColumn {
  header: string;
  field: string | null;
  recognised: boolean;
  samples: string[];
}

export interface FieldOption {
  value: string;
  label: string;
  group: "Contact" | "Account" | "Custom fields";
}

export interface Preview {
  rows: number;
  maxRows: number;
  columns: PreviewColumn[];
  fields: FieldOption[];
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  companiesCreated?: number;
  errors: { row: number; message: string }[];
  batchId: string;
  listId: string | null;
  listName: string | null;
  enrichmentQueued: number;
}

export interface ImportSettingsState {
  stage: string;
  ifExists: "update" | "skip";
  autoAssignAccounts: boolean;
  listMode: "none" | "existing" | "new";
  listId: string;
  newListName: string;
  verifyEmails: boolean;
  findMissingEmails: boolean;
}

export const ENTITY_COPY: Record<
  ImportEntityKey,
  { title: string; noun: string; entity: "contact" | "company"; api: string }
> = {
  contacts: { title: "Import contacts", noun: "people", entity: "contact", api: "/api/v1/contacts/import" },
  accounts: { title: "Import accounts", noun: "companies", entity: "company", api: "/api/v1/accounts/import" },
};
