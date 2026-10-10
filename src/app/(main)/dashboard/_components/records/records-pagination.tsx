"use client";

import Link from "next/link";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useUrlParams } from "./use-url-params";

export interface PaginationInfo {
  page: number;
  per_page: number;
  total_entries: number;
  total_pages: number;
}

/** Previous / next links over server-side pages, with the visible range. */
export function RecordsPagination({ pagination, noun }: { pagination: PaginationInfo; noun: string }) {
  const { hrefWith } = useUrlParams();
  const { page, per_page: perPage, total_entries: total, total_pages: pages } = pagination;
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  const hasPrev = page > 1;
  const hasNext = page < pages;

  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center justify-between gap-3 px-4">
      <p className="text-muted-foreground text-xs">
        <span className="font-mono tabular-nums">
          {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")}
        </span>{" "}
        of <span className="font-mono tabular-nums">{total.toLocaleString("en-US")}</span> {noun}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">
          Page <span className="font-mono tabular-nums">{page}</span> of{" "}
          <span className="font-mono tabular-nums">{pages}</span>
        </span>
        {hasPrev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefWith({ page: String(page - 1) })} scroll={false}>
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft data-icon="inline-start" aria-hidden="true" />
            Previous
          </Button>
        )}
        {hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefWith({ page: String(page + 1) })} scroll={false}>
              Next
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      </div>
    </nav>
  );
}
