"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { cn } from "cn";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { apiRequest } from "../../_components/records/api-client";

/** Star or unstar a sequence (starred ones sort first). Read-only for people who can't edit. */
export function StarButton({
  sequenceId,
  name,
  starred,
  canEdit,
}: {
  sequenceId: string;
  name: string;
  starred: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(starred);
  const [busy, setBusy] = useState(false);
  const label = value ? `Unstar ${name}` : `Star ${name}`;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-pressed={value}
      disabled={!canEdit || busy}
      onClick={async () => {
        setBusy(true);
        const next = !value;
        setValue(next);
        const result = await apiRequest(`/api/v1/emailer_campaigns/${sequenceId}`, {
          method: "PATCH",
          body: { starred: next },
        });
        setBusy(false);
        if (!result.ok) {
          setValue(!next);
          toast.error(result.error);
          return;
        }
        router.refresh();
      }}
    >
      <Star aria-hidden="true" className={cn(value ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
    </Button>
  );
}
