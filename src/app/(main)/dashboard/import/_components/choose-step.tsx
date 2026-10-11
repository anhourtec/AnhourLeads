"use client";

import { useId, useRef, useState } from "react";

import { Building2, Download, FileUp, Users } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { ENTITY_COPY, type ImportEntityKey, type ImportPermissions } from "./types";

const CARDS: {
  type: ImportEntityKey;
  icon: React.ReactNode;
  description: string;
  identifying: string;
  recommended: string[];
}[] = [
  {
    type: "contacts",
    icon: <Users aria-hidden="true" />,
    description: "Add people from a spreadsheet. Existing people are matched by email address.",
    identifying: "Include an email address, or a first and last name, in every row.",
    recommended: ["First name", "Last name", "Email", "Job title", "Company", "Website", "Country", "Stage"],
  },
  {
    type: "accounts",
    icon: <Building2 aria-hidden="true" />,
    description: "Add companies from a spreadsheet. Existing companies are matched by domain, then by name.",
    identifying: "Include a website or domain in every row, or at least the company name.",
    recommended: ["Company name", "Website", "Industry", "Employees", "Annual revenue", "Country", "Stage"],
  },
];

/** Step 1: pick contacts or accounts, acknowledge the data-use terms, choose a file. */
export function ChooseStep({
  permissions,
  maxRows,
  initialType,
  loading,
  error,
  onChoose,
}: {
  permissions: ImportPermissions;
  maxRows: number;
  initialType: ImportEntityKey | null;
  loading: ImportEntityKey | null;
  error: string | null;
  onChoose: (type: ImportEntityKey, file: File) => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-medium text-2xl tracking-tight">Import</h1>
        <p className="text-muted-foreground text-sm">
          Bring people or companies in from a CSV file. You'll check how each column maps before anything is saved.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {CARDS.map((card) => (
          <ImportCard
            key={card.type}
            card={card}
            allowed={permissions[card.type]}
            highlighted={initialType === card.type}
            maxRows={maxRows}
            loading={loading === card.type}
            onChoose={(file) => onChoose(card.type, file)}
          />
        ))}
      </div>
    </div>
  );
}

function ImportCard({
  card,
  allowed,
  highlighted,
  maxRows,
  loading,
  onChoose,
}: {
  card: (typeof CARDS)[number];
  allowed: boolean;
  highlighted: boolean;
  maxRows: number;
  loading: boolean;
  onChoose: (file: File) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const copy = ENTITY_COPY[card.type];

  return (
    <Card
      className={highlighted ? "gap-4 ring-2 ring-ring" : "gap-4"}
      data-testid={`import-card-${card.type}`}
      aria-labelledby={`${id}-title`}
      role="region"
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
            {card.icon}
          </span>
          <div className="flex flex-col gap-0.5">
            <CardTitle id={`${id}-title`} className="font-medium text-base">
              {copy.title}
            </CardTitle>
            <CardDescription>
              Up to <span className="font-mono tabular-nums">{maxRows.toLocaleString("en-US")}</span> rows per file, 5
              MB at most.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p>{card.description}</p>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">Recommended columns</p>
          <ul className="flex flex-wrap gap-1.5">
            {card.recommended.map((c) => (
              <li key={c} className="rounded-md border px-2 py-0.5 font-mono text-xs">
                {c}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{card.identifying}</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
          <Checkbox
            id={`${id}-agree`}
            checked={agreed}
            disabled={!allowed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={`${id}-agree`} className="font-normal text-xs leading-relaxed">
            I confirm this data was collected lawfully, that I may use it to contact these {copy.noun} for business
            purposes, and that I'll honour opt-outs and the do-not-contact list.
          </Label>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-label={`CSV file for ${copy.title.toLowerCase()}`}
          data-testid={`import-file-${card.type}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onChoose(file);
          }}
        />
        <Button size="sm" disabled={!allowed || !agreed || loading} onClick={() => input.current?.click()}>
          <FileUp data-icon="inline-start" aria-hidden="true" />
          {loading ? "Reading file…" : "Select CSV file"}
        </Button>
        {allowed ? (
          <Button asChild variant="outline" size="sm">
            <a href={`${copy.api}/template`} download>
              <Download data-icon="inline-start" aria-hidden="true" />
              Download sample template
            </a>
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">Your role can't import {copy.noun}.</p>
        )}
      </CardFooter>
    </Card>
  );
}
