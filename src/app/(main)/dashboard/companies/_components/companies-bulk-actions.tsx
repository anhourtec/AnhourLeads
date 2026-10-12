"use client";

import { useId, useState } from "react";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COMPANY_STAGE_LABELS, COMPANY_STAGES, type CompanyStage } from "@/lib/records-vocabulary";

import { apiRequest } from "../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../_components/records/confirm-delete-dialog";
import type { CompaniesPermissions, Option } from "./types";

/** Stage, owner and delete for the selected companies. */
export function CompaniesBulkActions({
  ids,
  members,
  permissions,
  onDone,
}: {
  ids: string[];
  members: Option[];
  permissions: CompaniesPermissions;
  onDone: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const count = ids.length;
  const noun = count === 1 ? "company" : "companies";

  async function run(path: string, body: Record<string, unknown>, success: string): Promise<string | null> {
    setPending(true);
    const result = await apiRequest(path, { body: { accountIds: ids, ...body } });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return result.error;
    }
    toast.success(success);
    onDone();
    router.refresh();
    return null;
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Bulk actions</legend>
      <span className="text-muted-foreground text-xs">
        <span className="font-mono tabular-nums">{count}</span> selected
      </span>
      {permissions.update ? (
        <>
          <label htmlFor={`${id}-stage`} className="sr-only">
            Change stage
          </label>
          <NativeSelect
            id={`${id}-stage`}
            size="sm"
            value=""
            disabled={pending}
            onChange={(event) => {
              const stage = event.target.value as CompanyStage | "";
              if (stage) {
                void run(
                  "/api/v1/accounts/bulk_update",
                  { stage },
                  `Moved ${count} ${noun} to ${COMPANY_STAGE_LABELS[stage]}.`,
                );
              }
            }}
          >
            <NativeSelectOption value="">Change stage…</NativeSelectOption>
            {COMPANY_STAGES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {COMPANY_STAGE_LABELS[s]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <label htmlFor={`${id}-owner`} className="sr-only">
            Change owner
          </label>
          <NativeSelect
            id={`${id}-owner`}
            size="sm"
            value=""
            disabled={pending}
            onChange={(event) => {
              const value = event.target.value;
              if (value) {
                void run(
                  "/api/v1/accounts/update_owners",
                  { ownerId: value === "none" ? null : value },
                  `Updated the owner of ${count} ${noun}.`,
                );
              }
            }}
          >
            <NativeSelectOption value="">Change owner…</NativeSelectOption>
            <NativeSelectOption value="none">Unassigned</NativeSelectOption>
            {members.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </>
      ) : null}
      {permissions.delete ? (
        <ConfirmDeleteDialog
          title={`Delete ${count} ${noun}?`}
          description="Their people stay in the workspace but lose the company link. This can't be undone."
          onConfirm={() => run("/api/v1/accounts/bulk_delete", {}, `Deleted ${count} ${noun}.`)}
        />
      ) : null}
    </fieldset>
  );
}
