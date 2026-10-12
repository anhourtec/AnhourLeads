"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Show or hide the onboarding hub card in the sidebar. */
export function HubVisibilityButton({ dismissed }: { readonly dismissed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await fetch("/api/v1/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hubDismissed: !dismissed }),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error("Couldn't save that. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={toggle} disabled={pending}>
      {dismissed ? <Eye data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
      {dismissed ? "Show in sidebar" : "Hide from sidebar"}
    </Button>
  );
}
