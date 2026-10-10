"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useUrlParams } from "./use-url-params";

/** Downloads the current filtered set as CSV (the export endpoint takes the same filters as the list). */
export function ExportButton({ endpoint }: { endpoint: string }) {
  const { searchParams } = useUrlParams();
  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");
  params.delete("per_page");
  const query = params.toString();
  return (
    <Button asChild variant="outline" size="sm">
      <a href={query ? `${endpoint}?${query}` : endpoint} download>
        <Download data-icon="inline-start" aria-hidden="true" />
        Export
      </a>
    </Button>
  );
}
