"use client";

import { useId, useMemo, useState } from "react";

import Link from "next/link";

import { CircleCheck, FileText, Info, Trash2, Upload } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COMPANY_STAGE_LABELS, COMPANY_STAGES, CONTACT_STAGE_LABELS, CONTACT_STAGES } from "@/lib/records-vocabulary";

import {
  ENTITY_COPY,
  type FieldOption,
  type ImportEntityKey,
  type ImportPermissions,
  type ImportSettingsState,
  type ListOption,
  type Preview,
} from "./types";

const GROUPS: FieldOption["group"][] = ["Contact", "Account", "Custom fields"];

/** Step 2: one card per CSV column with the field it maps to, then settings and enrichment. */
export function MappingStep({
  type,
  file,
  preview,
  permissions,
  lists,
  initialListId,
  onCancel,
  onImport,
}: {
  type: ImportEntityKey;
  file: File;
  preview: Preview;
  permissions: ImportPermissions;
  lists: ListOption[];
  initialListId: string | null;
  onCancel: () => void;
  onImport: (mapping: Record<string, string | null>, settings: ImportSettingsState) => Promise<string | null>;
}) {
  const id = useId();
  const copy = ENTITY_COPY[type];
  const [mapping, setMapping] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(preview.columns.map((c) => [c.header, c.field])),
  );
  const [hideRecognised, setHideRecognised] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialList = lists.find((l) => l.id === initialListId);
  const [settings, setSettings] = useState<ImportSettingsState>({
    stage: "",
    ifExists: "update",
    autoAssignAccounts: true,
    listMode: initialList ? "existing" : "none",
    listId: initialList?.id ?? lists[0]?.id ?? "",
    newListName: "",
    verifyEmails: false,
    findMissingEmails: false,
  });
  const set = <K extends keyof ImportSettingsState>(key: K, value: ImportSettingsState[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const recognisedCount = preview.columns.filter((c) => c.recognised).length;
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of Object.values(mapping)) if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([v]) => v));
  }, [mapping]);
  const visible = preview.columns.filter((c) => !(hideRecognised && c.recognised));
  const labelFor = (value: string) => preview.fields.find((f) => f.value === value)?.label ?? value;
  const stages =
    copy.entity === "contact"
      ? CONTACT_STAGES.map((s) => ({ value: s, label: CONTACT_STAGE_LABELS[s] }))
      : COMPANY_STAGES.map((s) => ({ value: s, label: COMPANY_STAGE_LABELS[s] }));
  const canList = permissions.updateList || permissions.createList;

  async function submit() {
    setError(null);
    if (!mappedCount) {
      setError("Map at least one column to a field.");
      return;
    }
    if (settings.listMode === "new" && !settings.newListName.trim()) {
      setError("Name the new list, or choose not to add to a list.");
      return;
    }
    setPending(true);
    const message = await onImport(mapping, settings);
    setPending(false);
    if (message) setError(message);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-medium text-2xl tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-xs">
          <span className="font-mono tabular-nums">{preview.rows.toLocaleString("en-US")}</span>{" "}
          {preview.rows === 1 ? "row" : "rows"} included
        </p>
      </div>

      <Card className="min-w-0 gap-4">
        <CardHeader>
          <CardTitle className="font-medium text-base">Column mappings</CardTitle>
          <CardDescription className="max-w-prose">
            Each column in your file goes into one field. Columns we recognise are mapped for you; check them, and pick
            a field for the rest or leave them out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Missing a field?{" "}
              <Link
                href="/dashboard/settings/custom-fields"
                className="text-primary underline-offset-4 hover:underline"
              >
                Create a custom field
              </Link>
              , then choose this file again.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <span className="font-mono tabular-nums">{preview.columns.length}</span> columns detected
            </span>
            <Badge variant="secondary" className="bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400">
              <CircleCheck aria-hidden="true" />
              <span className="font-mono tabular-nums">{recognisedCount}</span> recognised
            </Badge>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-hide`}
                checked={hideRecognised}
                onCheckedChange={(v) => setHideRecognised(v === true)}
              />
              <Label htmlFor={`${id}-hide`} className="font-normal">
                Hide recognised columns
              </Label>
            </div>
          </div>

          <section
            aria-label="Columns in your file"
            className="-mx-1 flex min-w-0 snap-x gap-3 overflow-x-auto px-1 pb-2"
            data-testid="mapping-columns"
          >
            {visible.length ? (
              visible.map((column) => {
                const value = mapping[column.header] ?? "";
                const selectId = `${id}-col-${preview.columns.indexOf(column)}`;
                return (
                  <div
                    key={column.header}
                    className="flex w-64 shrink-0 snap-start flex-col rounded-lg border bg-card"
                    data-testid="mapping-card"
                  >
                    <div className="flex flex-col gap-2 border-b p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-sm" title={column.header}>
                          {column.header || "(no header)"}
                        </span>
                        {value ? (
                          <CircleCheck
                            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-label="Mapped"
                          />
                        ) : null}
                      </div>
                      <Label htmlFor={selectId} className="sr-only">
                        Field for {column.header}
                      </Label>
                      <NativeSelect
                        id={selectId}
                        size="sm"
                        value={value}
                        onChange={(e) => setMapping((m) => ({ ...m, [column.header]: e.target.value || null }))}
                      >
                        <NativeSelectOption value="">Don't import</NativeSelectOption>
                        {GROUPS.map((group) => {
                          const options = preview.fields.filter((f) => f.group === group);
                          return options.length ? (
                            <NativeSelectOptGroup key={group} label={group}>
                              {options.map((f) => (
                                <NativeSelectOption key={f.value} value={f.value}>
                                  {f.label}
                                </NativeSelectOption>
                              ))}
                            </NativeSelectOptGroup>
                          ) : null;
                        })}
                      </NativeSelect>
                      {value && duplicates.has(value) ? (
                        <p className="text-amber-700 text-xs dark:text-amber-400">
                          {labelFor(value)} is mapped twice; only the first column is used.
                        </p>
                      ) : null}
                    </div>
                    <ul className="flex flex-col divide-y text-sm">
                      {column.samples.length ? (
                        [...new Set(column.samples)].map((sample) => (
                          <li key={sample} className="truncate px-3 py-2" title={sample}>
                            {sample}
                          </li>
                        ))
                      ) : (
                        <li className="px-3 py-2 text-muted-foreground text-xs">No values in the first rows</li>
                      )}
                    </ul>
                  </div>
                );
              })
            ) : (
              <p className="text-muted-foreground text-sm">Every column was recognised.</p>
            )}
          </section>

          <Tabs defaultValue="settings" className="gap-4">
            <TabsList variant="line">
              <TabsTrigger value="settings">Settings</TabsTrigger>
              {copy.entity === "contact" ? <TabsTrigger value="enrichment">Data enrichment</TabsTrigger> : null}
            </TabsList>
            <TabsContent value="settings">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${id}-stage`}>Stage</Label>
                  <NativeSelect
                    id={`${id}-stage`}
                    value={settings.stage}
                    onChange={(e) => set("stage", e.target.value)}
                  >
                    <NativeSelectOption value="">Use the stage from the file</NativeSelectOption>
                    {stages.map((s) => (
                      <NativeSelectOption key={s.value} value={s.value}>
                        Set every record to {s.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${id}-exists`}>If a record already exists</Label>
                  <NativeSelect
                    id={`${id}-exists`}
                    value={settings.ifExists}
                    onChange={(e) => set("ifExists", e.target.value === "skip" ? "skip" : "update")}
                  >
                    <NativeSelectOption value="update">Update it with the values from the file</NativeSelectOption>
                    <NativeSelectOption value="skip">Skip it and leave it unchanged</NativeSelectOption>
                  </NativeSelect>
                </div>
                {copy.entity === "contact" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-accounts`}>Assign accounts</Label>
                    <NativeSelect
                      id={`${id}-accounts`}
                      value={settings.autoAssignAccounts ? "yes" : "no"}
                      onChange={(e) => set("autoAssignAccounts", e.target.value === "yes")}
                    >
                      <NativeSelectOption value="yes">
                        Link or create the account from the website or email domain
                      </NativeSelectOption>
                      <NativeSelectOption value="no">Don't link people to accounts</NativeSelectOption>
                    </NativeSelect>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${id}-list`}>Add to a list</Label>
                  <NativeSelect
                    id={`${id}-list`}
                    value={settings.listMode}
                    disabled={!canList}
                    onChange={(e) => set("listMode", e.target.value as ImportSettingsState["listMode"])}
                  >
                    <NativeSelectOption value="none">Don't add to a list</NativeSelectOption>
                    {permissions.updateList && lists.length ? (
                      <NativeSelectOption value="existing">Add to an existing list</NativeSelectOption>
                    ) : null}
                    {permissions.createList ? (
                      <NativeSelectOption value="new">Create a new list</NativeSelectOption>
                    ) : null}
                  </NativeSelect>
                  {settings.listMode === "existing" ? (
                    <>
                      <Label htmlFor={`${id}-list-id`} className="sr-only">
                        List
                      </Label>
                      <NativeSelect
                        id={`${id}-list-id`}
                        value={settings.listId}
                        onChange={(e) => set("listId", e.target.value)}
                      >
                        {lists.map((l) => (
                          <NativeSelectOption key={l.id} value={l.id}>
                            {l.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </>
                  ) : null}
                  {settings.listMode === "new" ? (
                    <>
                      <Label htmlFor={`${id}-list-name`} className="sr-only">
                        New list name
                      </Label>
                      <Input
                        id={`${id}-list-name`}
                        placeholder="New list name"
                        maxLength={120}
                        value={settings.newListName}
                        onChange={(e) => set("newListName", e.target.value)}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </TabsContent>
            {copy.entity === "contact" ? (
              <TabsContent value="enrichment">
                <div className="flex flex-col gap-3">
                  {permissions.enrich ? (
                    <p className="text-muted-foreground text-sm">
                      Runs after the import for up to 200 people, using your own enrichment and verification.
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Your role can't run enrichment. Ask a member or manager to enrich these people after the import.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-verify`}
                      disabled={!permissions.enrich}
                      checked={settings.verifyEmails}
                      onCheckedChange={(v) => set("verifyEmails", v === true)}
                    />
                    <Label htmlFor={`${id}-verify`} className="font-normal">
                      Verify email addresses after the import
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-find`}
                      disabled={!permissions.enrich}
                      checked={settings.findMissingEmails}
                      onCheckedChange={(v) => set("findMissingEmails", v === true)}
                    />
                    <Label htmlFor={`${id}-find`} className="font-normal">
                      Find missing email addresses
                    </Label>
                  </div>
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
          {pending ? (
            <div role="status" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <span>
                Importing <span className="font-mono tabular-nums">{preview.rows.toLocaleString("en-US")}</span>{" "}
                {preview.rows === 1 ? "row" : "rows"}…
              </span>
              <Progress value={60} className="h-1.5 animate-pulse" aria-label="Import progress" />
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex min-w-0 items-center gap-1 rounded-lg border px-2 py-1 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-mono text-xs" title={file.name}>
            {file.name}
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Remove file" onClick={onCancel} disabled={pending}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            <Upload data-icon="inline-start" aria-hidden="true" />
            {pending ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
