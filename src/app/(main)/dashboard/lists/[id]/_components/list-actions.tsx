"use client";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { apiRequest } from "../../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../../_components/records/confirm-delete-dialog";
import { ListFormDialog } from "../../_components/list-form-dialog";
import type { ListRow } from "../../_components/types";
import { AddMembersDialog } from "./add-members-dialog";

export function ListActions({
  list,
  canAdd,
  canEdit,
  canDelete,
}: {
  list: ListRow;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  if (!canAdd && !canEdit && !canDelete) return null;
  return (
    <>
      {canAdd ? <AddMembersDialog listId={list.id} entityType={list.entityType} /> : null}
      {canEdit ? <ListFormDialog mode="edit" list={list} /> : null}
      {canDelete ? (
        <ConfirmDeleteDialog
          title="Delete this list?"
          description={`"${list.name}" will be deleted. The ${list.entityType === "contact" ? "people" : "companies"} in it are kept.`}
          onConfirm={async () => {
            const result = await apiRequest(`/api/v1/labels/${list.id}`, { method: "DELETE" });
            if (!result.ok) return result.error;
            toast.success("List deleted.");
            router.push("/dashboard/lists");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}
