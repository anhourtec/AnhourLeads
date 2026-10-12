import { Check, Circle, CircleAlert, LoaderCircle, Minus } from "lucide-react";

import type { DomainsView, DomainView } from "@/server/services/domains";

type StepState = "done" | "progress" | "action" | "todo" | "skip";

interface Step {
  title: string;
  state: StepState;
  detail: string;
}

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  progress: "In progress",
  action: "Action needed",
  todo: "Not started",
  skip: "Not needed",
};

const ICON: Record<StepState, React.ReactNode> = {
  done: <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
  progress: <LoaderCircle className="size-4 text-muted-foreground" aria-hidden="true" />,
  action: <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />,
  todo: <Circle className="size-4 text-muted-foreground" aria-hidden="true" />,
  skip: <Minus className="size-4 text-muted-foreground" aria-hidden="true" />,
};

export function stepsFor(d: DomainView, provider: DomainsView["provider"], target: string): Step[] {
  const owned = d.status !== "pending";
  let ownership: Step = {
    title: "Ownership verified",
    state: "progress",
    detail: "Add the TXT record. Usually minutes, up to an hour.",
  };
  if (d.status === "failing") {
    ownership = { title: "Ownership verified", state: "action", detail: "The TXT record is missing. Add it back." };
  } else if (d.status === "verified") {
    ownership = { title: "Ownership verified", state: "done", detail: "The TXT record was found." };
  }

  const pointedTitle = `Pointed at ${target}`;
  let pointed: Step = { title: pointedTitle, state: "todo", detail: "Checked with the next verification." };
  if (d.routing === "pointed")
    pointed = { title: pointedTitle, state: "done", detail: "The CNAME record is in place." };
  if (d.routing === "not_pointed") {
    pointed = { title: pointedTitle, state: "action", detail: "Add or fix the CNAME record." };
  }

  let https: Step;
  if (provider === "none") {
    https = { title: "HTTPS certificate", state: "skip", detail: "Certificates aren't managed by this installation." };
  } else if (!owned) {
    https = { title: "HTTPS certificate", state: "todo", detail: "Issued automatically once ownership is verified." };
  } else if (d.cert.status === "active") {
    https = { title: "HTTPS certificate", state: "done", detail: "Installed and renewed automatically." };
  } else if (d.cert.status === "problem") {
    https = {
      title: "HTTPS certificate",
      state: "action",
      detail: "The certificate isn't valid. Check the DNS records.",
    };
  } else {
    https = { title: "HTTPS certificate", state: "progress", detail: "Usually within 15 minutes of verification." };
  }

  const live =
    d.serving && d.routing === "pointed" && (https.state === "done" || https.state === "skip")
      ? { title: "Live", state: "done" as const, detail: "People can sign in on this hostname." }
      : { title: "Live", state: "todo" as const, detail: "Once the steps above are done." };
  return [ownership, pointed, https, live];
}

/** Ownership → pointed → HTTPS → live, each with its state in words (never colour alone). */
export function SetupSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Set-up progress">
      {steps.map((s, i) => (
        <li key={s.title} className="flex min-w-0 gap-2 rounded-lg border p-3">
          <span className="mt-0.5">{ICON[s.state]}</span>
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-sm">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </p>
            <p className="text-muted-foreground text-xs">
              {STATE_LABEL[s.state]} · {s.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
