"use client";

import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function ResearchError({ retry }: { retry?: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Research couldn't load</EmptyTitle>
        <EmptyDescription>Something went wrong loading crawl jobs. Try again in a moment.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={() => (retry ? retry() : window.location.reload())}>
          <RotateCw data-icon="inline-start" />
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
