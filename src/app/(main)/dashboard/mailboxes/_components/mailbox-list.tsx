import { Inbox, TriangleAlert } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";

import { MailboxStatusPill } from "../../_components/engage/tone-pill";
import { MailboxActions } from "./mailbox-actions";
import { MailboxDialog } from "./mailbox-dialog";
import { type Mailbox, type MailboxPermissions, PROVIDER_LABELS, SECURITY_LABELS } from "./types";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function MailboxCard({ mailbox, permissions }: { mailbox: Mailbox; permissions: MailboxPermissions }) {
  const usage = Math.min(100, Math.round((mailbox.sentToday / mailbox.dailyLimit) * 100));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="truncate font-mono text-sm" title={mailbox.email}>
          {mailbox.email}
        </CardTitle>
        <CardDescription className="truncate">
          {mailbox.displayName ?? "No display name"} · {PROVIDER_LABELS[mailbox.provider]}
        </CardDescription>
        <CardAction>
          <MailboxStatusPill status={mailbox.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Sent today</span>
            <span className="font-mono tabular-nums">
              {mailbox.sentToday.toLocaleString("en-US")} / {mailbox.dailyLimit.toLocaleString("en-US")}
            </span>
          </div>
          <Progress value={usage} aria-label={`Sent ${mailbox.sentToday} of ${mailbox.dailyLimit} today`} />
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Sending window">
            <span className="font-mono tabular-nums">
              {mailbox.sendingWindowStart}–{mailbox.sendingWindowEnd}
            </span>{" "}
            <span className="text-muted-foreground text-xs">{mailbox.timezone}</span>
          </Detail>
          <Detail label="Active sequences">
            <span className="font-mono tabular-nums">{mailbox.activeSequences}</span>
          </Detail>
          <Detail label="SMTP">
            {mailbox.smtpHost ? (
              <span className="font-mono text-xs">
                {mailbox.smtpHost}
                {mailbox.smtpPort ? `:${mailbox.smtpPort}` : ""} · {SECURITY_LABELS[mailbox.smtpSecure]}
              </span>
            ) : (
              <span className="text-muted-foreground">Not set</span>
            )}
          </Detail>
          <Detail label="Password">
            {mailbox.hasPassword ? (
              <span className="text-muted-foreground">
                Ends in <span className="font-mono">{mailbox.passwordHint}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Detail>
          <div className="col-span-2">
            <Detail label="Postal address">
              {mailbox.postalAddress ?? <span className="text-muted-foreground">Missing</span>}
            </Detail>
          </div>
        </dl>
        {mailbox.issues.length ? (
          <div className="flex gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 text-xs dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <ul className="flex flex-col gap-1">
              {mailbox.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      {permissions.update || permissions.remove ? (
        <CardFooter className="mt-auto flex-wrap gap-2">
          <MailboxActions mailbox={mailbox} canUpdate={permissions.update} canDelete={permissions.remove} />
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function MailboxList({ mailboxes, permissions }: { mailboxes: Mailbox[]; permissions: MailboxPermissions }) {
  if (mailboxes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No mailboxes yet</EmptyTitle>
          <EmptyDescription>
            {permissions.create
              ? "Connect a mailbox with its SMTP settings so sequences can send from it."
              : "A manager connects mailboxes. Ask one to add the mailbox you want to send from."}
          </EmptyDescription>
        </EmptyHeader>
        {permissions.create ? (
          <EmptyContent>
            <MailboxDialog mode="create" />
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {mailboxes.map((m) => (
        <MailboxCard key={m.id} mailbox={m} permissions={permissions} />
      ))}
    </div>
  );
}
