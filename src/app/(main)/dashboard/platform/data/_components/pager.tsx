"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { numberFormat } from "./tabs";

export interface PaginationInfo {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

export function Pager({ pagination, onPage }: { pagination: PaginationInfo | null; onPage: (page: number) => void }) {
  if (!pagination || pagination.total_entries === 0) return null;
  const from = (pagination.page - 1) * pagination.per_page + 1;
  const to = Math.min(pagination.total_entries, pagination.page * pagination.per_page);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono text-muted-foreground text-xs tabular-nums">
        {numberFormat.format(from)}–{numberFormat.format(to)} of {numberFormat.format(pagination.total_entries)}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pagination.page >= pagination.total_pages}
          onClick={() => onPage(pagination.page + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
