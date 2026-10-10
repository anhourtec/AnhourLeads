"use client";

import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Shared body for the people and companies error boundaries. */
export function RecordsError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Couldn't load {what}</EmptyTitle>
        <EmptyDescription>
          Something went wrong while loading this page. Try again; if it keeps happening, contact your workspace
          administrator.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={() => retry()}>
          <RotateCw data-icon="inline-start" aria-hidden="true" />
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
