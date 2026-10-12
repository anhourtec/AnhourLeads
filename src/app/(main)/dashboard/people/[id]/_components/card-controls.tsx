"use client";

import { useEffect, useId, useState } from "react";

import { useRouter } from "next/navigation";

import { MailSearch, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CONTACT_STAGE_LABELS, CONTACT_STAGES, type ContactStage } from "@/lib/records-vocabulary";

import { apiRequest } from "../../../_components/records/api-client";
import { useContactTab } from "./contact-layout";
import { TaskDialog } from "./task-dialog";

/** Stage picker that saves on change. */
export function StageSelect({ contactId, stage }: { contactId: string; stage: ContactStage }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(stage);
  const [pending, setPending] = useState(false);

  useEffect(() => setValue(stage), [stage]);

  async function change(next: ContactStage) {
    const previous = value;
    setValue(next);
    setPending(true);
    const res = await apiRequest(`/api/v1/contacts/${contactId}`, { method: "PATCH", body: { stage: next } });
    setPending(false);
    if (!res.ok) {
      setValue(previous);
      toast.error(res.error);
      return;
    }
    toast.success(`Stage set to ${CONTACT_STAGE_LABELS[next]}.`);
    router.refresh();
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">
        Stage
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={value}
        disabled={pending}
        onChange={(e) => void change(e.target.value as ContactStage)}
        className="w-44"
      >
        {CONTACT_STAGES.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {CONTACT_STAGE_LABELS[s]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

/** Find and verify the email with the workspace's own enrichment (people/match). */
export function AccessEmailButton({ contactId, hasEmail }: { contactId: string; hasEmail: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    const res = await apiRequest<{ person?: { email?: string | null } | null }>("/api/v1/people/match", {
      body: { contactId },
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(hasEmail ? "Email checked." : "Lookup finished.");
    router.refresh();
  }
  const idleLabel = hasEmail ? "Verify email" : "Access email";
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      <MailSearch data-icon="inline-start" aria-hidden="true" />
      {pending ? "Checking…" : idleLabel}
    </Button>
  );
}

/** The person's local time, from their time zone (client-side so it stays current). */
export function LocalTime({ timezone }: { timezone: string | null }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!timezone) return;
    const render = () => {
      try {
        setText(
          new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date()),
        );
      } catch {
        setText(null);
      }
    };
    render();
    const timer = window.setInterval(render, 60_000);
    return () => window.clearInterval(timer);
  }, [timezone]);
  if (!timezone) return <span className="text-muted-foreground">Time zone unknown</span>;
  return (
    <span>
      {text ?? <span className="text-muted-foreground">Unknown time zone</span>}{" "}
      <span className="text-muted-foreground text-xs">({timezone})</span>
    </span>
  );
}

export function SeeAllFieldsButton({ count }: { count: number }) {
  const [, setTab] = useContactTab();
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto w-fit px-0"
      onClick={() => {
        setTab("fields");
        document.getElementById("contact-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      See all fields
      <span className="font-mono text-muted-foreground tabular-nums">{count}</span>
    </Button>
  );
}

export function AddTaskButton({
  contactId,
  companyId,
  personName,
}: {
  contactId: string;
  companyId: string | null;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="Add task" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
      </Button>
      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        contactId={contactId}
        companyId={companyId}
        personName={personName}
      />
    </>
  );
}
