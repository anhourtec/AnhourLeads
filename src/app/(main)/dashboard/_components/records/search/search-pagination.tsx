"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import type { Pagination } from "./types";

/** ‹ page select › and "1 – 25 of 1,234". */
export function SearchPagination({
  pagination,
  onPage,
  noun,
}: {
  pagination: Pagination;
  onPage: (page: number) => void;
  noun: string;
}) {
  const { page, per_page: perPage, total_entries: total, total_pages: pages } = pagination;
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  const options = Array.from({ length: Math.min(pages, 500) }, (_, i) => i + 1);
  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <NativeSelect
        aria-label="Page"
        size="sm"
        className="w-20 font-mono"
        value={String(page)}
        onChange={(e) => onPage(Number(e.target.value))}
      >
        {options.map((p) => (
          <NativeSelectOption key={p} value={String(p)}>
            {p}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      <p className="font-mono text-muted-foreground text-xs tabular-nums" data-testid="search-range">
        {first.toLocaleString("en-US")} – {last.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </p>
    </nav>
  );
}
