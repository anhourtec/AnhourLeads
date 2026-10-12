"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Database,
  Handshake,
  Inbox,
  Info,
  LogIn,
  Mail,
  Send,
  Server,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ONBOARDING_GOALS,
  ONBOARDING_ROLE_LABELS,
  ONBOARDING_ROLES,
  type OnboardingGoal,
  type OnboardingRole,
  TEAM_SIZE_LABELS,
  TEAM_SIZES,
  type TeamSize,
} from "@/lib/onboarding";

interface OnboardingFlowProps {
  readonly firstName: string;
  readonly initial: { role: string | null; teamSize: string | null; goals: string[] };
  /** Only managers and above connect mailboxes; members are asked to get one connected. */
  readonly canConnectMailbox: boolean;
}

const GOAL_CARDS: Record<
  OnboardingGoal,
  { label: string; outcome: string; description: string; icon: typeof Send; tile: string }
> = {
  outbound: {
    label: "Outbound",
    outcome: "Find and reach new leads",
    description: "Build lists of the right people, run sequences from your mailbox and track what comes back.",
    icon: Send,
    tile: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  inbound: {
    label: "Inbound",
    outcome: "Turn interest into leads",
    description: "Capture who is showing interest and follow up while it's fresh.",
    icon: LogIn,
    tile: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  enrichment: {
    label: "Enrichment",
    outcome: "Keep your data clean",
    description: "Fill in missing fields and verify emails, with the source of every value kept.",
    icon: Database,
    tile: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  deal_execution: {
    label: "Deal execution",
    outcome: "Move deals forward",
    description: "Track deals by stage, follow up on time and see what needs attention.",
    icon: Handshake,
    tile: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

type Provider = "google" | "microsoft" | "smtp";

const PROVIDERS: { id: Provider; name: string; detail: string; icon: typeof Mail }[] = [
  { id: "google", name: "Google", detail: "Gmail or Google Workspace", icon: Mail },
  { id: "microsoft", name: "Microsoft", detail: "Outlook or Microsoft 365", icon: Inbox },
  { id: "smtp", name: "Other", detail: "Any provider, with SMTP settings", icon: Server },
];

function isRole(value: string | null): value is OnboardingRole {
  return (ONBOARDING_ROLES as readonly string[]).includes(value ?? "");
}
function isTeamSize(value: string | null): value is TeamSize {
  return (TEAM_SIZES as readonly string[]).includes(value ?? "");
}

async function save(body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch("/api/v1/onboarding", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** First-run flow: about you, goals, then connect a mailbox (or skip). */
export function OnboardingFlow({ firstName, initial, canConnectMailbox }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [role, setRole] = useState<OnboardingRole | null>(isRole(initial.role) ? initial.role : null);
  const [teamSize, setTeamSize] = useState<TeamSize | null>(isTeamSize(initial.teamSize) ? initial.teamSize : null);
  const [goals, setGoals] = useState<OnboardingGoal[]>(
    initial.goals.filter((g): g is OnboardingGoal => (ONBOARDING_GOALS as readonly string[]).includes(g)),
  );
  const [provider, setProvider] = useState<Provider | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(body: Record<string, unknown>, next: () => void) {
    setPending(true);
    setError(null);
    const ok = await save(body);
    setPending(false);
    if (!ok) {
      setError("That didn't save. Check your connection and try again.");
      return;
    }
    next();
  }

  const toggleGoal = (goal: OnboardingGoal) =>
    setGoals((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]));

  const finish = (outcome: "email_connected" | "email_skipped", href: string) =>
    run({ finished: true, outcome, ...(accepted ? { antiSpamAccepted: true } : {}) }, () => {
      router.replace(href);
      router.refresh();
    });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        {step > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2"
            aria-label="Back"
            onClick={() => setStep((s) => (s === 2 ? 1 : 0))}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        ) : null}
        <span className="font-mono text-xs uppercase tracking-wide" aria-live="polite">
          {step < 2 ? `Question ${step + 1} of 2` : "Last step"}
        </span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === 0 ? (
        <section className="flex flex-col gap-6" aria-labelledby="step-title">
          <div className="flex flex-col gap-2">
            <h1 id="step-title" className="page-title text-3xl">
              Welcome, {firstName}. What do you do?
            </h1>
            <p className="text-muted-foreground">This helps us show you the most useful things first.</p>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 font-medium text-sm">Your role</legend>
            <RadioGroup
              value={role ?? ""}
              onValueChange={(value) => setRole(value as OnboardingRole)}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {ONBOARDING_ROLES.map((r) => (
                <Label
                  key={r}
                  htmlFor={`role-${r}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem id={`role-${r}`} value={r} />
                  {ONBOARDING_ROLE_LABELS[r]}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 font-medium text-sm">How many people are on your team?</legend>
            <RadioGroup
              value={teamSize ?? ""}
              onValueChange={(value) => setTeamSize(value as TeamSize)}
              className="flex flex-wrap gap-2"
            >
              {TEAM_SIZES.map((size) => (
                <Label
                  key={size}
                  htmlFor={`size-${size}`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem id={`size-${size}`} value={size} />
                  {TEAM_SIZE_LABELS[size]}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <div>
            <Button
              size="sm"
              disabled={!role || pending}
              onClick={() => run({ role, ...(teamSize ? { teamSize } : {}) }, () => setStep(1))}
            >
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-6" aria-labelledby="step-title">
          <div className="flex flex-col gap-2">
            <h1 id="step-title" className="page-title text-3xl">
              How do you want to start?
            </h1>
            <p className="text-muted-foreground">
              Pick as many as you like. Everything stays available; this only shapes your getting-started list.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Goals">
            {ONBOARDING_GOALS.map((goal) => {
              const card = GOAL_CARDS[goal];
              const selected = goals.includes(goal);
              return (
                <li
                  key={goal}
                  className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors ${selected ? "border-primary" : ""}`}
                  data-testid={`goal-${goal}`}
                >
                  <span
                    className={`flex size-9 items-center justify-center rounded-lg ${card.tile}`}
                    aria-hidden="true"
                  >
                    <card.icon className="size-5" />
                  </span>
                  <span className="table-head-mono">{card.label}</span>
                  <span className="font-heading font-medium text-lg leading-snug">{card.outcome}</span>
                  <span className="flex-1 text-muted-foreground text-sm">{card.description}</span>
                  <Button
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    className={`w-full ${selected ? "bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
                    aria-pressed={selected}
                    aria-label={`${selected ? "Selected" : "Select"}: ${card.label}`}
                    onClick={() => toggleGoal(goal)}
                  >
                    {selected ? <Check data-icon="inline-start" /> : null}
                    {selected ? "Selected" : "Select"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <div>
            <Button size="sm" disabled={pending} onClick={() => run({ goals }, () => setStep(2))}>
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex max-w-3xl flex-col gap-6" aria-labelledby="step-title">
          <div className="flex flex-col gap-2">
            <h1 id="step-title" className="page-title text-3xl">
              Connect your email to get started
            </h1>
            <p className="text-muted-foreground">
              Sequences send from a mailbox you own, so replies land in your inbox and your sending stays under your
              control.
            </p>
          </div>
          {canConnectMailbox ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 font-medium text-sm">Choose your email provider:</legend>
              <RadioGroup
                value={provider ?? ""}
                onValueChange={(value) => setProvider(value as Provider)}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                {PROVIDERS.map((p) => (
                  <Label
                    key={p.id}
                    htmlFor={`provider-${p.id}`}
                    className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                  >
                    <span className="flex w-full items-center gap-2">
                      <p.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium">{p.name}</span>
                      <RadioGroupItem id={`provider-${p.id}`} value={p.id} className="ml-auto" />
                    </span>
                    <span className="text-muted-foreground text-xs">{p.detail}</span>
                  </Label>
                ))}
              </RadioGroup>
              {provider === "google" || provider === "microsoft" ? (
                <Alert>
                  <Info aria-hidden="true" />
                  <AlertDescription>
                    Signing in with {provider === "google" ? "Google" : "Microsoft"} is coming soon. For now, connect
                    the same mailbox with the SMTP settings from your provider (an app password works).
                  </AlertDescription>
                </Alert>
              ) : null}
            </fieldset>
          ) : (
            <Alert>
              <Building2 aria-hidden="true" />
              <AlertDescription>
                In this workspace, mailboxes are connected by a manager or administrator. Ask one to connect yours; you
                can prospect and build lists in the meantime.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
            <Checkbox
              id="anti-spam"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              className="mt-0.5"
            />
            <Label htmlFor="anti-spam" className="block font-normal text-sm leading-relaxed">
              I'll follow this workspace's terms and the law when sending. I won't send spam or unsolicited, misleading
              or harassing email, and I'll honour every opt-out.
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canConnectMailbox ? (
              <Button
                size="sm"
                disabled={!provider || !accepted || pending}
                onClick={() => finish("email_connected", "/dashboard/mailboxes?new=1")}
              >
                <Mail data-icon="inline-start" />
                Connect email
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!accepted || pending}
                onClick={() => finish("email_skipped", "/dashboard/home")}
              >
                <ArrowRight data-icon="inline-start" />
                Continue
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => finish("email_skipped", "/dashboard/home")}
            >
              Skip for now
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
