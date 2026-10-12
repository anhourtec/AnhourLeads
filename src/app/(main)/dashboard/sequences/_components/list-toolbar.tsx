"use client";

import { Star } from "lucide-react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Toggle } from "@/components/ui/toggle";

import { SearchBox } from "../../_components/records/search-box";
import { useUrlParams } from "../../_components/records/use-url-params";

const STATUSES = [
  ["", "Any status"],
  ["draft", "Draft"],
  ["active", "Active"],
  ["paused", "Paused"],
  ["archived", "Archived"],
] as const;

/** Search and filters, all kept in the URL. */
export function ListToolbar({ owners, tags }: { owners: { id: string; name: string }[]; tags: string[] }) {
  const { searchParams, setParams } = useUrlParams();
  const starred = searchParams.get("starred") === "true";
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <SearchBox placeholder="Search sequences" label="Search sequences" />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <NativeSelect
          size="sm"
          aria-label="Status"
          className="w-full sm:w-36"
          value={searchParams.get("status") ?? ""}
          onChange={(e) => setParams({ status: e.target.value || null })}
        >
          {STATUSES.map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          size="sm"
          aria-label="Owner"
          className="w-full sm:w-40"
          value={searchParams.get("owner") ?? ""}
          onChange={(e) => setParams({ owner: e.target.value || null })}
        >
          <NativeSelectOption value="">Any owner</NativeSelectOption>
          {owners.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          size="sm"
          aria-label="Tag"
          className="w-full sm:w-36"
          value={searchParams.get("tag") ?? ""}
          onChange={(e) => setParams({ tag: e.target.value || null })}
        >
          <NativeSelectOption value="">Any tag</NativeSelectOption>
          {tags.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {t}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Toggle
          size="sm"
          variant="outline"
          aria-label="Starred only"
          pressed={starred}
          onPressedChange={(on) => setParams({ starred: on ? "true" : null })}
        >
          <Star aria-hidden="true" className={starred ? "fill-current" : undefined} />
          Starred
        </Toggle>
      </div>
    </div>
  );
}
