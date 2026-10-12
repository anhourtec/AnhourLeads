"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ErrorState } from "../_components/pipeline/error-state";

export default function EnrichmentError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorState title="Data enrichment couldn't load" />
      <Button size="sm" variant="outline" onClick={reset}>
        <RotateCw data-icon="inline-start" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
