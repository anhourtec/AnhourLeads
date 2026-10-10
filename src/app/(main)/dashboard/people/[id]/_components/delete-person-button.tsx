"use client";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { apiRequest } from "../../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../../_components/records/confirm-delete-dialog";

export function DeletePersonButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDeleteDialog
      title={`Delete ${name}?`}
      description="They are removed from lists and sequences. Deals and tasks stay but lose the link. This can't be undone."
      onConfirm={async () => {
        const result = await apiRequest(`/api/v1/contacts/${id}`, { method: "DELETE" });
        if (!result.ok) return result.error;
        toast.success(`${name} deleted.`);
        router.push("/dashboard/people");
        router.refresh();
        return null;
      }}
    />
  );
}
