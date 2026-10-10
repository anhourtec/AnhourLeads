"use client";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { useUrlParams } from "../../_components/records/use-url-params";

export function StatusFilter() {
  const { searchParams, setParams } = useUrlParams();
  return (
    <NativeSelect
      size="sm"
      aria-label="Filter by status"
      className="w-full sm:w-40"
      value={searchParams.get("status") ?? ""}
      onChange={(e) => setParams({ status: e.target.value || null })}
    >
      <NativeSelectOption value="">All statuses</NativeSelectOption>
      <NativeSelectOption value="draft">Draft</NativeSelectOption>
      <NativeSelectOption value="active">Active</NativeSelectOption>
      <NativeSelectOption value="paused">Paused</NativeSelectOption>
      <NativeSelectOption value="archived">Archived</NativeSelectOption>
    </NativeSelect>
  );
}
