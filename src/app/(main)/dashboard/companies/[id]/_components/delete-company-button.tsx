"use client";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { apiRequest } from "../../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../../_components/records/confirm-delete-dialog";

export function DeleteCompanyButton({ id, name, peopleCount }: { id: string; name: string; peopleCount: number }) {
  const router = useRouter();
  const people =
    peopleCount === 0
      ? "It has no people."
      : `Its ${peopleCount.toLocaleString("en-US")} ${peopleCount === 1 ? "person stays" : "people stay"} in the workspace without a company.`;
  return (
    <ConfirmDeleteDialog
      title={`Delete ${name}?`}
      description={`${people} Deals and tasks lose the link. This can't be undone.`}
      onConfirm={async () => {
        const result = await apiRequest(`/api/v1/accounts/${id}`, { method: "DELETE" });
        if (!result.ok) return result.error;
        toast.success(`${name} deleted.`);
        router.push("/dashboard/companies");
        router.refresh();
        return null;
      }}
    />
  );
}
