"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ErrorState } from "../../_components/pipeline/error-state";

export default function DeliverabilityError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <ErrorState title="Email setup and health couldn't load" />
      <Button size="sm" variant="outline" onClick={reset}>
        <RotateCw data-icon="inline-start" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
