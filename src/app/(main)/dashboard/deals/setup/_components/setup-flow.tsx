"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowLeft, CircleCheck, DatabaseZap, Handshake, Lock, Plus, RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { stageListProblem } from "@/lib/deal-pipelines";
import type { PipelineDto } from "@/server/services/pipelines";

import { type EditableStage, StageListEditor } from "../../../_components/pipeline/stage-list-editor";

type Step = "start" | "details";

/**
 * Deals setup (reference §11): choose how to start, then name the pipeline and its stages. Only
 * members with pipeline:manage can finish; everyone else sees the settings read-only.
 */
export function SetupFlow({
  pipeline,
  canManage,
  canCreateDeal,
  brandName,
}: {
  readonly pipeline: PipelineDto;
  readonly canManage: boolean;
  readonly canCreateDeal: boolean;
  readonly brandName: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState<EditableStage[]>(
    pipeline.stages.map((s) => ({ key: s.id, id: s.id, name: s.name, type: s.type, probability: s.probability })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function finish() {
    const problem = name.trim() ? stageListProblem(stages) : "Name the pipeline.";
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const renamed = await apiFetch(`/api/v1/pipelines/${pipeline.id}`, {
      method: "PATCH",
      body: { name: name.trim() },
    });
    const saved = renamed.ok
      ? await apiFetch(`/api/v1/pipelines/${pipeline.id}/stages`, {
          method: "PUT",
          body: {
            stages: stages.map((s) => ({
              ...(s.id ? { id: s.id } : {}),
              name: s.name.trim(),
              type: s.type,
              probability: s.probability,
            })),
          },
        })
      : renamed;
    setPending(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setDone(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-24">
      {step === "start" ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="page-title">How would you like to start?</h1>
            <p className="text-muted-foreground text-sm">Pick where your deals live. You can change this later.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="opacity-70" aria-disabled="true">
              <CardHeader>
                <RefreshCw className="size-5 text-muted-foreground" aria-hidden="true" />
                <CardTitle>Import from CRM</CardTitle>
                <CardDescription>
                  Keep deals in sync with an external CRM. This needs a CRM connection, which isn't available in this
                  installation yet. Import a CSV from the deals page instead.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" disabled>
                  <Lock data-icon="inline-start" />
                  Not available yet
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <DatabaseZap className="size-5 text-primary" aria-hidden="true" />
                <CardTitle>Use {brandName} as your CRM</CardTitle>
                <CardDescription>
                  Track deals here, next to the people, companies and sequences behind them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" onClick={() => setStep("details")}>
                  <Handshake data-icon="inline-start" />
                  Continue
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="page-title">Now, add your pipeline details</h1>
            <p className="text-muted-foreground text-sm">
              After this setup, only workspace administrators can edit pipelines and stages (Settings → Deal pipelines).
            </p>
          </div>
          {!canManage ? (
            <Alert>
              <Lock aria-hidden="true" />
              <AlertDescription>
                You can see the pipeline, but only an administrator or owner can change it and finish setup.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardContent>
              <Field>
                <FieldLabel htmlFor="setup-pipeline-name">Pipeline name</FieldLabel>
                <Input
                  id="setup-pipeline-name"
                  value={name}
                  maxLength={80}
                  disabled={!canManage}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Stages</CardTitle>
              <CardDescription>Administrators can add and edit stages later in settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <StageListEditor stages={stages} onChange={setStages} readOnly={!canManage} />
            </CardContent>
          </Card>
          <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 backdrop-blur md:left-(--sidebar-width)">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setStep("start")}>
                <ArrowLeft data-icon="inline-start" />
                Go back
              </Button>
              <Button size="sm" disabled={!canManage || pending} onClick={() => void finish()}>
                <CircleCheck data-icon="inline-start" />
                {pending ? "Saving…" : "Finish setup"}
              </Button>
            </div>
          </div>
        </>
      )}
      <Dialog open={done} onOpenChange={(open) => !open && router.push("/dashboard/deals")}>
        <DialogContent className="sm:max-w-md">
          <div className="flex justify-center pt-2 text-primary" aria-hidden="true">
            <CircleCheck className="size-16" strokeWidth={1.25} />
          </div>
          <DialogHeader className="items-center text-center">
            <DialogTitle className="page-title">You're all set up</DialogTitle>
            <DialogDescription>Your pipeline is ready. Add your first deal to start tracking it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/deals")}>
              Maybe later
            </Button>
            {canCreateDeal ? (
              <Button size="sm" onClick={() => router.push("/dashboard/deals?create=1")}>
                <Plus data-icon="inline-start" />
                Create deal
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
