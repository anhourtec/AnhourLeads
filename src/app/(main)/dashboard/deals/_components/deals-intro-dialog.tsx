"use client";

import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { ChartColumn, Handshake, Sparkles, Trophy, Workflow, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

export const introKey = (userId: string) => `anhour:deals-intro:${userId}`;

const BENEFITS = [
  { icon: ChartColumn, text: "See which deals need attention with value and win rate by stage" },
  { icon: Workflow, text: "Connect deals to your people, companies, sequences and tasks" },
  { icon: Zap, text: "Let workflows move deals and create follow-ups for you" },
];

/** First visit to Deals: what deal management does, with a way into the pipeline setup. Shown once per user. */
export function DealsIntroDialog({ userId }: { readonly userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(getLocalStorageValue(introKey(userId)) !== "seen");
  }, [userId]);

  const dismiss = () => {
    setLocalStorageValue(introKey(userId), "seen");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-lg">
        <div
          className="flex h-36 items-center justify-center gap-4 rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-card shadow-xs">
            <Handshake className="size-6" />
          </div>
          <div className="flex items-center gap-2 rounded-full bg-card px-4 py-2 font-medium text-foreground text-sm shadow-xs">
            <Trophy className="size-4 text-primary" />
            Won this month
            <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-primary-foreground text-xs">+1</span>
          </div>
          <Sparkles className="size-5" />
        </div>
        <DialogHeader>
          <DialogTitle className="page-title">Deal management made easy</DialogTitle>
          <DialogDescription>
            Set up your sales pipeline and track every deal from first meeting to signature, right next to your
            prospecting and outreach.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">What you can do</p>
          <ul className="flex flex-col gap-2">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={dismiss}>
            Maybe later
          </Button>
          <Button
            size="sm"
            onClick={() => {
              dismiss();
              router.push("/dashboard/deals/setup");
            }}
          >
            <Sparkles data-icon="inline-start" />
            Begin setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
