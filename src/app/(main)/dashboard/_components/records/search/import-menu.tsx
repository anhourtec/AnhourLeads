"use client";

import { useState } from "react";

import Link from "next/link";

import { ChevronDown, FileSpreadsheet, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CompanyFormDialog } from "../../../companies/_components/company-form-dialog";
import { PersonFormDialog } from "../../../people/_components/person-form-dialog";
import type { Option } from "./types";

/** "Import ▾": add a single record, or go to the CSV import wizard. */
export function ImportMenu({
  entity,
  canCreate,
  canImport,
  members,
  companies,
}: {
  entity: "contact" | "company";
  canCreate: boolean;
  canImport: boolean;
  members: Option[];
  companies: { id: string; name: string; domain: string | null }[];
}) {
  const [single, setSingle] = useState(false);
  if (!canCreate && !canImport) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Import
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canCreate ? (
            <DropdownMenuItem onSelect={() => setSingle(true)}>
              <UserPlus aria-hidden="true" />
              {entity === "contact" ? "Single contact" : "Single company"}
            </DropdownMenuItem>
          ) : null}
          {canImport ? (
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/import?type=${entity === "contact" ? "contacts" : "accounts"}`}>
                <FileSpreadsheet aria-hidden="true" />
                CSV file
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canCreate && entity === "contact" ? (
        <PersonFormDialog members={members} companies={companies} open={single} onOpenChange={setSingle} hideTrigger />
      ) : null}
      {canCreate && entity === "company" ? (
        <CompanyFormDialog members={members} open={single} onOpenChange={setSingle} hideTrigger />
      ) : null}
    </>
  );
}
