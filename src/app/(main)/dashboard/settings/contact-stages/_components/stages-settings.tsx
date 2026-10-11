"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowDown, ArrowUp, Info, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-fetch";
import type { RecordStageEntity, RecordStageView, StageTriggerEvent } from "@/lib/record-stages";

import { PageHeader } from "../../../_components/pipeline/page-header";

interface TriggerView {
  event: StageTriggerEvent;
  label: string;
  description: string;
  stageKey: string | null;
}

function StageList({
  entity,
  initial,
  canManage,
}: {
  readonly entity: RecordStageEntity;
  readonly initial: RecordStageView[];
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setStages(next);
  };

  async function save() {
    setPending(true);
    setError(null);
    const res = await apiFetch<{ stages: RecordStageView[] }>("/api/v1/record_stages", {
      method: "PUT",
      body: {
        entityType: entity,
        stages: stages.map((s) => ({ key: s.key, label: s.label.trim(), protected: s.protected })),
      },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStages(res.data.stages);
    toast.success("Stages saved");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{entity === "contact" ? "Contact stages" : "Account stages"}</CardTitle>
        <CardDescription>
          Rename and reorder stages. The name shows everywhere the stage appears.
          {entity === "contact"
            ? " Protected stages keep their value when set by hand, whatever the triggers say."
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="table-head-mono">Stage name</TableHead>
                <TableHead className="table-head-mono hidden sm:table-cell">Key</TableHead>
                {entity === "contact" ? <TableHead className="table-head-mono">Protected</TableHead> : null}
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Order</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((s, i) => (
                <TableRow key={s.key}>
                  <TableCell className="min-w-40">
                    <Input
                      aria-label={`Name for ${s.key}`}
                      value={s.label}
                      maxLength={40}
                      disabled={!canManage}
                      onChange={(e) =>
                        setStages(stages.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))
                      }
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell className="hidden font-mono text-muted-foreground text-xs sm:table-cell">
                    {s.key}
                  </TableCell>
                  {entity === "contact" ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Don't let triggers override ${s.label} when set manually`}
                        checked={s.protected}
                        disabled={!canManage}
                        onCheckedChange={(c) =>
                          setStages(stages.map((x) => (x.key === s.key ? { ...x, protected: c === true } : x)))
                        }
                      />
                    </TableCell>
                  ) : null}
                  {canManage ? (
                    <TableCell className="whitespace-nowrap text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${s.label} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${s.label} down`}
                        disabled={i === stages.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="flex items-start gap-2 text-muted-foreground text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Custom stages are coming. For now, rename the existing ones to fit your process.
        </p>
        {canManage ? (
          <Button size="sm" className="self-end" disabled={pending} onClick={() => void save()}>
            <Save data-icon="inline-start" />
            {pending ? "Saving…" : "Save stages"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Triggers({
  initial,
  stages,
  canManage,
}: {
  readonly initial: TriggerView[];
  readonly stages: RecordStageView[];
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [triggers, setTriggers] = useState(initial);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const res = await apiFetch<{ stage_triggers: TriggerView[] }>("/api/v1/stage_triggers", {
      method: "PUT",
      body: { triggers: triggers.map((t) => ({ event: t.event, stageKey: t.stageKey })) },
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTriggers(res.data.stage_triggers);
    toast.success("Triggers saved");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Stage triggers</CardTitle>
        <CardDescription>When one of these happens, the person moves to the stage you choose.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="table-head-mono">When</TableHead>
                <TableHead className="table-head-mono">Set stage to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {triggers.map((t) => (
                <TableRow key={t.event}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <div className="font-medium text-sm">{t.label}</div>
                    <div className="text-muted-foreground text-xs">{t.description}</div>
                  </TableCell>
                  <TableCell className="min-w-44">
                    <NativeSelect
                      aria-label={`Stage when: ${t.label}`}
                      value={t.stageKey ?? ""}
                      disabled={!canManage}
                      onChange={(e) =>
                        setTriggers(
                          triggers.map((x) => (x.event === t.event ? { ...x, stageKey: e.target.value || null } : x)),
                        )
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="">Don't change</NativeSelectOption>
                      {stages.map((s) => (
                        <NativeSelectOption key={s.key} value={s.key}>
                          {s.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="flex items-start gap-2 text-muted-foreground text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Protected stages set by hand are never changed by these triggers.
        </p>
        {canManage ? (
          <Button size="sm" className="self-end" disabled={pending} onClick={() => void save()}>
            <Save data-icon="inline-start" />
            {pending ? "Saving…" : "Save triggers"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Settings → Contact fields and stages: tabs Stages / Account stages / Triggers. */
export function StagesSettings({
  initialTab,
  contactStages,
  accountStages,
  triggers,
  canManage,
}: {
  readonly initialTab: "stages" | "accounts" | "triggers";
  readonly contactStages: RecordStageView[];
  readonly accountStages: RecordStageView[];
  readonly triggers: TriggerView[];
  readonly canManage: boolean;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Contact fields and stages"
        description="Name the stages people and accounts move through, and choose which events move them automatically."
      />
      {!canManage ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>Only administrators and owners can change stages and triggers.</AlertDescription>
        </Alert>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b *:data-[slot=tabs-trigger]:flex-none"
        >
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="accounts">Account stages</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
        </TabsList>
        <TabsContent value="stages" className="pt-4">
          <StageList entity="contact" initial={contactStages} canManage={canManage} />
        </TabsContent>
        <TabsContent value="accounts" className="pt-4">
          <StageList entity="company" initial={accountStages} canManage={canManage} />
        </TabsContent>
        <TabsContent value="triggers" className="pt-4">
          <Triggers initial={triggers} stages={contactStages} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
