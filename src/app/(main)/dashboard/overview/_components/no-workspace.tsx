import { Building2 } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function NoWorkspace({ name }: { readonly name: string }) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-1">
        <h1 className="font-medium text-2xl tracking-tight">Welcome, {name}</h1>
        <p className="text-muted-foreground text-sm">You aren't in a workspace yet.</p>
      </div>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No workspace</EmptyTitle>
          <EmptyDescription>
            Ask a workspace administrator to invite you, then open the link in the email.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
