import { Pill, type Tone } from "../../_components/pipeline/pills";

const JOB: Record<string, [Tone, string]> = {
  queued: ["neutral", "Queued"],
  running: ["info", "Running"],
  completed: ["positive", "Completed"],
  failed: ["negative", "Failed"],
};

export function JobStatusPill({ status }: { status: string }) {
  const [tone, label] = JOB[status] ?? ["neutral", status];
  return <Pill tone={tone}>{label}</Pill>;
}

const EMAIL: Record<string, [Tone, string]> = {
  valid: ["positive", "Valid"],
  unverified: ["neutral", "Unverified"],
  unknown: ["neutral", "Unknown"],
  catch_all: ["attention", "Catch-all"],
  role: ["attention", "Role address"],
  invalid: ["negative", "Invalid"],
  disposable: ["negative", "Disposable"],
};

export function EmailStatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const [tone, label] = EMAIL[status] ?? ["neutral", status];
  return <Pill tone={tone}>{label}</Pill>;
}

const SOURCE: Record<string, string> = {
  crawler: "Website",
  pattern: "Email format",
  input: "Your file",
  records: "Your records",
};

export function sourceLabel(source: string | null): string {
  return source ? (SOURCE[source] ?? source) : "—";
}
