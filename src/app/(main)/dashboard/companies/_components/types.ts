import type { CompanyDto } from "@/server/services/companies";

export type CompanyRow = CompanyDto;

export interface Option {
  id: string;
  name: string;
}

export interface CompaniesPermissions {
  create: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}
