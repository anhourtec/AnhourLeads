"use client";

import { useEffect, useId, useState } from "react";

import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  CheckSquare,
  CircleDot,
  GitBranch,
  Handshake,
  ListPlus,
  Mail,
  MailCheck,
  MailX,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { apiRequest } from "../../../_components/records/api-client";
import { type TabId, useContactTab } from "./contact-layout";

interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  actor: { id: string; name: string } | null;
  occurredAt: string;
}

const TYPE_GROUPS: { value: string; label: string; types: string[] }[] = [
  { value: "", label: "All activity", types: [] },
  {
    value: "emails",
    label: "Emails",
    types: [
      "email_sent",
      "email_delivered",
      "email_opened",
      "email_clicked",
      "email_replied",
      "email_bounced",
      "email_not_sent",
      "email_unsubscribed",
      "spam_blocked",
    ],
  },
  { value: "notes", label: "Notes", types: ["note_added"] },
  { value: "tasks", label: "Tasks and calls", types: ["task_created", "task_completed", "call_logged"] },
  { value: "stages", label: "Stage changes", types: ["stage_changed", "marked_interested", "contact_unresponsive"] },
  {
    value: "sequences",
    label: "Sequences and lists",
    types: ["contact_added_to_sequence", "contact_finished_sequence", "contact_finished_step", "contact_added_to_list"],
  },
  { value: "deals", label: "Deals and meetings", types: ["deal_created", "deal_stage_changed", "meeting_booked"] },
  { value: "record", label: "Record changes", types: ["contact_created", "contact_updated"] },
];

function ActivityIcon({ type }: { type: string }) {
  const props = { className: "size-4", "aria-hidden": true } as const;
  if (type === "note_added") return <StickyNote {...props} />;
  if (type === "email_replied") return <MessageSquare {...props} />;
  if (type === "email_bounced" || type === "email_not_sent" || type === "email_unsubscribed" || type === "spam_blocked")
    return <MailX {...props} />;
  if (type === "email_delivered" || type === "email_opened" || type === "email_clicked")
    return <MailCheck {...props} />;
  if (type.startsWith("email")) return <Mail {...props} />;
  if (type === "call_logged") return <Phone {...props} />;
  if (type.startsWith("task")) return <CheckSquare {...props} />;
  if (type === "stage_changed") return <GitBranch {...props} />;
  if (type === "contact_added_to_list") return <ListPlus {...props} />;
  if (type.startsWith("contact_added_to_sequence") || type.startsWith("contact_finished")) return <Send {...props} />;
  if (type.startsWith("deal") || type === "meeting_booked") return <Handshake {...props} />;
  if (type === "contact_created") return <UserPlus {...props} />;
  if (type === "contact_updated") return <CircleDot {...props} />;
  return <Activity {...props} />;
}

function ActivitiesPanel({ contactId, active }: { contactId: string; active: boolean }) {
  const id = useId();
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const types = TYPE_GROUPS.find((g) => g.value === group)?.types ?? [];
    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    for (const t of types) params.append("type", t);
    void apiRequest<{ activities: ActivityItem[]; pagination: { total_pages: number } }>(
      `/api/v1/contacts/${contactId}/activities?${params.toString()}`,
    ).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setItems([]);
        return;
      }
      setError(null);
      setItems((prev) => (page === 1 ? res.data.activities : [...(prev ?? []), ...res.data.activities]));
      setTotalPages(res.data.pagination.total_pages);
    });
    return () => {
      cancelled = true;
    };
  }, [active, contactId, group, page]);

  let body: React.ReactNode;
  if (error) {
    body = (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  } else if (items === null) {
    body = <p className="text-muted-foreground text-sm">Loading activity…</p>;
  } else if (items.length === 0) {
    body = <p className="text-muted-foreground text-sm">Nothing has happened here yet.</p>;
  } else {
    body = (
      <ol className="relative flex flex-col gap-4 border-l pl-5" aria-label="Activity timeline">
        {items.map((item) => (
          <li key={item.id} className="relative flex flex-col gap-0.5" data-activity-type={item.type}>
            <span className="absolute top-0 -left-[1.95rem] flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground">
              <ActivityIcon type={item.type} />
            </span>
            <p className="break-words text-sm">{item.summary}</p>
            <p className="text-muted-foreground text-xs">
              {item.actor ? `${item.actor.name} · ` : ""}
              <time dateTime={item.occurredAt} title={new Date(item.occurredAt).toUTCString()}>
                {formatDistanceToNowStrict(new Date(item.occurredAt), { addSuffix: true })}
              </time>
            </p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-type`} className="text-muted-foreground text-xs">
          Show
        </label>
        <NativeSelect
          id={`${id}-type`}
          size="sm"
          value={group}
          className="w-52"
          onChange={(e) => {
            setGroup(e.target.value);
            setPage(1);
            setItems(null);
          }}
        >
          {TYPE_GROUPS.map((g) => (
            <NativeSelectOption key={g.value} value={g.value}>
              {g.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {body}
      {items && page < totalPages ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setPage((p) => p + 1)}>
          Show older activity
        </Button>
      ) : null}
    </div>
  );
}

const LABELS: Record<TabId, string> = {
  prospect: "Prospect",
  activities: "Activities",
  sequences: "Sequences",
  fields: "All fields",
};

export function ContactTabs({
  contactId,
  prospect,
  sequences,
  fields,
  sequenceCount,
}: {
  contactId: string;
  prospect: React.ReactNode;
  sequences: React.ReactNode;
  fields: React.ReactNode;
  sequenceCount: number;
}) {
  const [tab, setTab] = useContactTab();
  return (
    <Tabs id="contact-tabs" value={tab} onValueChange={(v) => setTab(v as TabId)} className="min-w-0 gap-4">
      <div className="max-w-full overflow-x-auto">
        <TabsList>
          {(Object.keys(LABELS) as TabId[]).map((t) => (
            <TabsTrigger key={t} value={t} className="px-3">
              {LABELS[t]}
              {t === "sequences" && sequenceCount ? (
                <span className="font-mono text-muted-foreground text-xs tabular-nums">{sequenceCount}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="prospect" className="min-w-0">
        {prospect}
      </TabsContent>
      <TabsContent value="activities" className="min-w-0">
        <ActivitiesPanel contactId={contactId} active={tab === "activities"} />
      </TabsContent>
      <TabsContent value="sequences" className="min-w-0">
        {sequences}
      </TabsContent>
      <TabsContent value="fields" className="min-w-0">
        {fields}
      </TabsContent>
    </Tabs>
  );
}
