"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { Info, TriangleAlert, X } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const KEY = "anhour:sequences:bounce-guard-banner";

/** Dismissible note that bounce guard pauses sequences with too many bounces. Dismissal is per browser. */
export function BounceGuardBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(KEY) !== "dismissed");
    } catch {
      setVisible(true);
    }
  }, []);
  if (!visible) return null;
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>Bounce guard is on</AlertTitle>
      <AlertDescription>
        <p>
          Sequences whose emails bounce unusually often are paused automatically to protect your domains. You can change
          the threshold or turn it off in{" "}
          <Link
            href="/dashboard/settings/deliverability/sending-protection"
            className="text-foreground underline underline-offset-4"
          >
            sending protection settings
          </Link>
          .
        </p>
      </AlertDescription>
      <AlertAction>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss"
          onClick={() => {
            setVisible(false);
            try {
              window.localStorage.setItem(KEY, "dismissed");
            } catch {
              // Private mode: it shows again next time.
            }
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** Shown when no mailbox in the workspace can send. */
export function NoMailboxBar({ canLink }: { canLink: boolean }) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="text-inherit">
        <p>
          No mailbox is ready to send. Connect an email account so sequences can send from it.{" "}
          {canLink ? (
            <Link href="/dashboard/mailboxes?new=1" className="font-medium underline underline-offset-4">
              Link mailbox
            </Link>
          ) : (
            "Ask a manager to link one."
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
