"use client";

import { useId, useState } from "react";

import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import type { SendingPolicyView } from "@/lib/sending-policy";
import type { ProtectionCounters } from "@/server/services/sending-policy";

import { BounceLogsSheet } from "./bounce-logs-sheet";
import { numberFormat } from "./tabs";

type BoolKey =
  | "autoPauseOnAuthIssue"
  | "restrictUnverified"
  | "restrictCatchAll"
  | "requireSignature"
  | "gradualRamp"
  | "bounceGuard";
type Patch = Partial<Pick<SendingPolicyView, BoolKey | "bounceThreshold" | "workspaceDailyLimit">>;

function Counter({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-medium font-mono text-2xl tabular-nums">{numberFormat.format(value)}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function PolicyRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  children,
  locked,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange?: (value: boolean) => void;
  children?: React.ReactNode;
  locked?: boolean;
}) {
  const id = useId();
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={id} className="flex items-center gap-2 font-medium text-sm">
            {title}
            {locked ? <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
          </label>
          <p id={`${id}-d`} className="text-muted-foreground text-xs">
            {description}
          </p>
        </div>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onChange?.(v)}
          aria-describedby={`${id}-d`}
        />
      </div>
      {children}
    </li>
  );
}

export function ProtectionTab({
  initialPolicy,
  counters,
  canManage,
}: {
  initialPolicy: SendingPolicyView;
  counters: ProtectionCounters;
  canManage: boolean;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(String(Math.round(initialPolicy.bounceThreshold * 1000) / 10));
  const [limit, setLimit] = useState(
    initialPolicy.workspaceDailyLimit ? String(initialPolicy.workspaceDailyLimit) : "",
  );
  const [limitOn, setLimitOn] = useState(initialPolicy.workspaceDailyLimit !== null);
  const readOnly = !canManage || saving;

  async function save(patch: Patch, message: string): Promise<boolean> {
    const before = policy;
    setPolicy({ ...policy, ...patch });
    setSaving(true);
    const res = await apiFetch<{ sending_policy: SendingPolicyView }>("/api/v1/sending_policy", {
      method: "PATCH",
      body: patch,
    });
    setSaving(false);
    if (!res.ok) {
      setPolicy(before);
      toast.error(res.error);
      return false;
    }
    setPolicy(res.data.sending_policy);
    toast.success(message);
    return true;
  }

  const toggle = (key: BoolKey, label: string) => (value: boolean) =>
    save({ [key]: value } as Patch, `${label} ${value ? "turned on" : "turned off"}`);

  async function saveThreshold() {
    const n = Number(threshold);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      toast.error("Use a bounce threshold between 1% and 50%.");
      setThreshold(String(Math.round(policy.bounceThreshold * 1000) / 10));
      return;
    }
    if (Math.abs(n / 100 - policy.bounceThreshold) < 1e-9) return;
    await save({ bounceThreshold: n / 100 }, "Bounce threshold saved");
  }

  async function saveLimit(on: boolean, raw: string) {
    if (!on) {
      if (policy.workspaceDailyLimit !== null)
        await save({ workspaceDailyLimit: null }, "Workspace sending limit turned off");
      return;
    }
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1 || n > 100_000) {
      if (raw) toast.error("Use a whole number between 1 and 100,000.");
      return;
    }
    if (n === policy.workspaceDailyLimit) return;
    await save({ workspaceDailyLimit: n }, "Workspace sending limit saved");
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">Last {counters.days} days.</p>
        <BounceLogsSheet />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Counter
          label="Risky sends held back"
          value={counters.riskySendsHeldBack}
          hint="Messages a protection below stopped before they were sent."
        />
        <Counter
          label="Sequences auto-paused"
          value={counters.sequencesAutoPaused}
          hint="Paused by bounce guard or an authentication problem."
        />
        <Counter
          label="Contacts screened"
          value={counters.contactsScreened}
          hint={`${numberFormat.format(counters.blockedMessages)} messages blocked for any reason, including do-not-contact.`}
        />
        <Counter label="Bounced" value={counters.bounced} hint="Messages the receiving server rejected." />
      </div>

      {!canManage ? (
        <p
          className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-muted-foreground text-sm"
          role="note"
        >
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          You can see these protections. An administrator can change them.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Domain protection</CardTitle>
            <CardDescription>Keep a domain with broken authentication from damaging its reputation.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              <PolicyRow
                title="Automatic sending adjustments"
                description="Pause sending from a domain when its SPF, DKIM or DMARC check fails, until it's fixed."
                checked={policy.autoPauseOnAuthIssue}
                disabled={readOnly}
                onChange={toggle("autoPauseOnAuthIssue", "Automatic sending adjustments")}
              />
            </ul>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Who gets emailed</CardTitle>
            <CardDescription>Screen recipients before each message goes out.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              <PolicyRow
                title="Restrict unverified emails"
                description="Only send to addresses that verified as valid."
                checked={policy.restrictUnverified}
                disabled={readOnly}
                onChange={toggle("restrictUnverified", "Restrict unverified emails")}
              />
              <PolicyRow
                title="Restrict catch-all domains"
                description="Hold messages to domains that accept every address, where delivery can't be confirmed."
                checked={policy.restrictCatchAll}
                disabled={readOnly}
                onChange={toggle("restrictCatchAll", "Restrict catch-all domains")}
              />
              <PolicyRow
                title="Require email signatures"
                description="Don't send from a mailbox until it has a signature."
                checked={policy.requireSignature}
                disabled={readOnly}
                onChange={toggle("requireSignature", "Require email signatures")}
              />
              <PolicyRow
                title="One-click unsubscribe"
                description="Every message carries an unsubscribe link and header. Always on."
                checked
                disabled
                locked
              />
            </ul>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Sending safeguards</CardTitle>
            <CardDescription>Limit volume and stop sequences that bounce too much.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              <PolicyRow
                title="Gradual sending increase"
                description="New mailboxes start at 20 a day and grow about 10% a day up to their limit."
                checked={policy.gradualRamp}
                disabled={readOnly}
                onChange={toggle("gradualRamp", "Gradual sending increase")}
              />
              <PolicyRow
                title="Bounce guard"
                description="Pause a sequence when its recent bounce rate goes over the threshold."
                checked={policy.bounceGuard}
                disabled={readOnly}
                onChange={toggle("bounceGuard", "Bounce guard")}
              >
                <div className="flex items-center gap-2">
                  <label htmlFor="bounce-threshold" className="text-muted-foreground text-xs">
                    Threshold
                  </label>
                  <Input
                    id="bounce-threshold"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={50}
                    step={0.5}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    onBlur={saveThreshold}
                    disabled={readOnly || !policy.bounceGuard}
                    className="h-7 w-20 font-mono tabular-nums"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
              </PolicyRow>
              <PolicyRow
                title="Workspace sending limit"
                description="Cap how many emails the whole workspace sends per day, across mailboxes."
                checked={limitOn}
                disabled={readOnly}
                onChange={(on) => {
                  setLimitOn(on);
                  if (!on) void saveLimit(false, "");
                  else if (limit) void saveLimit(true, limit);
                }}
              >
                {limitOn ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor="workspace-limit" className="text-muted-foreground text-xs">
                      Emails per day
                    </label>
                    <Input
                      id="workspace-limit"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100000}
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      onBlur={() => saveLimit(true, limit)}
                      disabled={readOnly}
                      className="h-7 w-28 font-mono tabular-nums"
                    />
                  </div>
                ) : null}
              </PolicyRow>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
