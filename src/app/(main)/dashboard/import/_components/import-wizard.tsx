"use client";

import { useState } from "react";

import { apiRequest } from "../../_components/records/api-client";
import { ChooseStep } from "./choose-step";
import { MappingStep } from "./mapping-step";
import { ResultStep } from "./result-step";
import {
  ENTITY_COPY,
  type ImportEntityKey,
  type ImportPermissions,
  type ImportReport,
  type ImportSettingsState,
  type ListOption,
  type Preview,
} from "./types";

type Step =
  | { kind: "choose" }
  | { kind: "mapping"; type: ImportEntityKey; file: File; preview: Preview }
  | { kind: "done"; type: ImportEntityKey; report: ImportReport; fileName: string };

/** Choose a file → map its columns and pick settings → import → summary. */
export function ImportWizard({
  permissions,
  lists,
  maxRows,
  initialType,
  initialListId,
}: {
  permissions: ImportPermissions;
  lists: ListOption[];
  maxRows: number;
  initialType: ImportEntityKey | null;
  initialListId: string | null;
}) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<ImportEntityKey | null>(null);

  async function choose(type: ImportEntityKey, file: File) {
    setError(null);
    if (!/\.(csv|txt)$/i.test(file.name) && file.type && !file.type.includes("csv") && !file.type.includes("text")) {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    setLoading(type);
    const form = new FormData();
    form.append("file", file);
    const res = await apiRequest<Preview>(`${ENTITY_COPY[type].api}/preview`, { body: form });
    setLoading(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.data.rows > res.data.maxRows) {
      setError(
        `This file has ${res.data.rows.toLocaleString("en-US")} rows. Import up to ${res.data.maxRows.toLocaleString("en-US")} at a time.`,
      );
      return;
    }
    setStep({ kind: "mapping", type, file, preview: res.data });
  }

  async function runImport(
    type: ImportEntityKey,
    file: File,
    mapping: Record<string, string | null>,
    settings: ImportSettingsState,
  ): Promise<string | null> {
    const form = new FormData();
    form.append("file", file);
    form.append("mapping", JSON.stringify(mapping));
    const payload: Record<string, unknown> = {
      fileName: file.name,
      stageMode: settings.stage ? "fixed" : "csv",
      ifExists: settings.ifExists,
    };
    if (settings.stage) payload.stage = settings.stage;
    if (type === "contacts") {
      payload.autoAssignAccounts = settings.autoAssignAccounts;
      if (settings.verifyEmails || settings.findMissingEmails) {
        payload.enrichment = { verifyEmails: settings.verifyEmails, findMissingEmails: settings.findMissingEmails };
      }
    }
    if (settings.listMode === "existing" && settings.listId) payload.listId = settings.listId;
    if (settings.listMode === "new" && settings.newListName.trim()) payload.newListName = settings.newListName.trim();
    form.append("settings", JSON.stringify(payload));
    const res = await apiRequest<ImportReport>(ENTITY_COPY[type].api, { body: form });
    if (!res.ok) return res.error;
    setStep({ kind: "done", type, report: res.data, fileName: file.name });
    return null;
  }

  if (step.kind === "choose") {
    return (
      <ChooseStep
        permissions={permissions}
        maxRows={maxRows}
        initialType={initialType}
        loading={loading}
        error={error}
        onChoose={choose}
      />
    );
  }
  if (step.kind === "mapping") {
    return (
      <MappingStep
        type={step.type}
        file={step.file}
        preview={step.preview}
        permissions={permissions}
        lists={lists.filter((l) => l.entityType === ENTITY_COPY[step.type].entity)}
        initialListId={initialListId}
        onCancel={() => setStep({ kind: "choose" })}
        onImport={(mapping, settings) => runImport(step.type, step.file, mapping, settings)}
      />
    );
  }
  return (
    <ResultStep
      type={step.type}
      fileName={step.fileName}
      report={step.report}
      onAgain={() => setStep({ kind: "choose" })}
    />
  );
}
