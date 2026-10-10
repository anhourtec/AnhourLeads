import { CircleAlert } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Shown when a page's data couldn't load. */
export function ErrorState({
  title = "This page couldn't load",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {description ?? "Refresh the page to try again. If it keeps happening, contact support."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
