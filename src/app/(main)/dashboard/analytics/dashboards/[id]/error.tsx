"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ErrorState } from "../../../_components/pipeline/error-state";

export default function AnalyticsError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorState title="This dashboard couldn't load" />
      <Button size="sm" variant="outline" onClick={reset}>
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
