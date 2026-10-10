"use client";

import { useState } from "react";

import { PlugZap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { apiRequest } from "../../_components/records/api-client";

/** Connect and sign in to the mailbox's saved SMTP settings, without sending anything. */
export function TestConnectionButton({ mailboxId, disabled }: { mailboxId: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending || disabled}
      onClick={async () => {
        setPending(true);
        const result = await apiRequest<{ ok: boolean; message: string }>(`/api/v1/email_accounts/${mailboxId}/test`, {
          method: "POST",
        });
        setPending(false);
        if (!result.ok) toast.error(result.error);
        else if (result.data.ok) toast.success(result.data.message);
        else toast.error(result.data.message);
      }}
    >
      <PlugZap data-icon="inline-start" aria-hidden="true" />
      {pending ? "Testing…" : "Test connection"}
    </Button>
  );
}
