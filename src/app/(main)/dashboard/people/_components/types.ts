import type { ContactDto } from "@/server/services/contacts";

export type PersonRow = ContactDto;

export interface Option {
  id: string;
  name: string;
}

export interface CompanyOption {
  id: string;
  name: string;
  domain: string | null;
}

export interface PeoplePermissions {
  create: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}
