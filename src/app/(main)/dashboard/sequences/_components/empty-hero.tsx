import { CalendarClock, ListOrdered, MessageSquareReply, Send } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { CreateManuallyButton, CreateWithAiButton } from "./create-flow";

const EXPLAINERS = [
  {
    icon: ListOrdered,
    title: "One plan, step by step",
    text: "Put emails, calls, LinkedIn touches and to-dos in order. Reorder steps or test two versions of an email.",
  },
  {
    icon: CalendarClock,
    title: "Sends when you choose",
    text: "Waits between steps and a weekly schedule decide when each email goes out, within your mailbox limits.",
  },
  {
    icon: MessageSquareReply,
    title: "Stops when they answer",
    text: "A reply, a booked meeting or an unsubscribe takes the person out of the sequence automatically.",
  },
] as const;

/** First-run state: no sequences in the workspace yet. */
export function EmptyHero({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <section
        aria-labelledby="first-sequence"
        className="flex flex-col items-center gap-3 rounded-xl border bg-primary/5 px-4 py-10 text-center sm:px-10"
      >
        <span className="flex size-14 items-center justify-center rounded-full border bg-background">
          <Send className="size-6 text-primary" aria-hidden="true" />
        </span>
        <h2 id="first-sequence" className="font-medium text-xl tracking-tight">
          Create your first sequence
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">
          Reach people automatically with a series of emails, calls and tasks that runs on your schedule.
        </p>
        {canCreate ? (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <CreateWithAiButton />
            <CreateManuallyButton />
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">Ask a member or manager to create one.</p>
        )}
      </section>
      <div className="grid gap-3 md:grid-cols-3">
        {EXPLAINERS.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="gap-2 py-4">
            <CardContent className="flex flex-col gap-2 px-4">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <h3 className="font-medium text-sm">{title}</h3>
              <p className="text-muted-foreground text-sm">{text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
