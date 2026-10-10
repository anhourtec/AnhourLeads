"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format-display";

/** Previous / next links that keep the current filters in the URL. */
export function ListPagination({
  page,
  totalPages,
  total,
  noun,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
  readonly noun: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <nav className="flex items-center justify-between gap-2 text-muted-foreground text-xs" aria-label="Pagination">
      <span className="tabular-nums">
        {formatNumber(total)} {noun}
        {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
      </span>
      {totalPages > 1 ? (
        <div className="flex gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)} scroll={false}>
                <ChevronLeft data-icon="inline-start" />
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>
          )}
          {page < totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)} scroll={false}>
                Next
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      ) : null}
    </nav>
  );
}
