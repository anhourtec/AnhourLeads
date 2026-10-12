"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { apiRequest } from "../../_components/records/api-client";

/** Activate (approve) or pause (abort) a sequence. The API explains what's missing when it can't start. */
export function ActiveSwitch({
  sequenceId,
  name,
  status,
  canLaunch,
  withLabel = false,
}: {
  sequenceId: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  canLaunch: boolean;
  withLabel?: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(status === "active");
  const [busy, setBusy] = useState(false);
  const disabled = !canLaunch || status === "archived" || busy;
  const id = `active-${sequenceId}`;
  // Radix renders a hidden form input whose inline style doesn't serialise identically on the
  // server, so the switch mounts on the client only (a same-size placeholder renders first).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const control = (
    <span className="inline-flex items-center gap-2">
      {mounted ? null : <span aria-hidden="true" className="inline-block h-[1.15rem] w-8 rounded-full bg-input" />}
      {!mounted ? null : (
        <Switch
          id={id}
          checked={on}
          disabled={disabled}
          aria-label={withLabel ? undefined : `Active: ${name}`}
          onCheckedChange={async (next) => {
            setBusy(true);
            setOn(next);
            const result = await apiRequest(`/api/v1/emailer_campaigns/${sequenceId}/${next ? "approve" : "abort"}`, {
              method: "POST",
            });
            setBusy(false);
            if (!result.ok) {
              setOn(!next);
              toast.error(result.error);
              return;
            }
            toast.success(next ? "Sequence activated." : "Sequence paused.");
            router.refresh();
          }}
        />
      )}
      {withLabel ? (
        <label htmlFor={id} className="text-sm">
          {on ? "Active" : "Activate"}
        </label>
      ) : null}
    </span>
  );

  if (canLaunch && status !== "archived") return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{control}</span>
      </TooltipTrigger>
      <TooltipContent>
        {status === "archived" ? "Archived sequences can't be activated." : "You can't start or pause sequences."}
      </TooltipContent>
    </Tooltip>
  );
}
