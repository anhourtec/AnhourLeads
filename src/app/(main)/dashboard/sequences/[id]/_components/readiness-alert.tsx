import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SequenceView } from "@/server/services/sequences";

/** What's missing before a draft or paused sequence can be activated. */
export function ReadinessAlert({ sequence, stepCount }: { sequence: SequenceView; stepCount: number }) {
  const todo: string[] = [];
  if (stepCount === 0) todo.push("Add at least one step.");
  if (!sequence.mailbox) todo.push("Pick a mailbox to send from in Settings.");
  else for (const issue of sequence.mailbox.issues) todo.push(issue);
  if (todo.length === 0) return null;
  return (
    <Alert>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>Before you activate</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
