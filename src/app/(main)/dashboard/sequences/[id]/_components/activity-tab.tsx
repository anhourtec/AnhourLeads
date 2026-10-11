import Link from "next/link";

import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Ban,
  CircleCheck,
  type LucideIcon,
  Mail,
  MailOpen,
  MailX,
  MessageSquareReply,
  MousePointerClick,
  Phone,
  SquareCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { SequenceActivityItem } from "@/server/services/sequence-insights";

const ICONS: Record<string, LucideIcon> = {
  email_sent: Mail,
  email_opened: MailOpen,
  email_clicked: MousePointerClick,
  email_replied: MessageSquareReply,
  email_bounced: MailX,
  email_not_sent: Ban,
  email_unsubscribed: UserMinus,
  contact_added_to_sequence: UserPlus,
  contact_finished_sequence: CircleCheck,
  contact_finished_step: CircleCheck,
  contact_unresponsive: UserMinus,
  task_created: SquareCheck,
  task_completed: SquareCheck,
  call_logged: Phone,
};

/** Everything that happened in this sequence, newest first. */
export function ActivityTab({ items }: { items: SequenceActivityItem[] }) {
  if (!items.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Activity aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>Sends, opens, replies and tasks from this sequence will show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col rounded-xl border bg-card" aria-label="Sequence activity">
      {items.map((item) => {
        const Icon = ICONS[item.type] ?? Activity;
        const at = new Date(item.occurredAt);
        return (
          <li key={item.id} className="flex min-w-0 items-start gap-3 border-b px-4 py-3 last:border-b-0">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="break-words text-sm">{item.summary}</p>
              <p className="text-muted-foreground text-xs">
                {item.contact ? (
                  <>
                    <Link href={`/dashboard/people/${item.contact.id}`} className="underline-offset-4 hover:underline">
                      {item.contact.name}
                    </Link>
                    {" · "}
                  </>
                ) : null}
                <time dateTime={item.occurredAt} title={at.toUTCString()}>
                  {formatDistanceToNow(at, { addSuffix: true })}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
