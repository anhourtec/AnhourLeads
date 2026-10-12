"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Building2, Copy, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-fetch";
import type { DataHealth, DuplicateGroup, HealthCard } from "@/server/services/data-health";

import { ActivityCard } from "./activity-card";
import { DuplicatesCard } from "./duplicates-card";
import { num, percent } from "./format";
import type { EnrichmentPermissions } from "./types";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-medium font-mono text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-muted-foreground text-xs">{hint}</CardContent> : null}
    </Card>
  );
}

function EnrichableCard({ card, canEnrich }: { card: HealthCard; canEnrich: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const share = card.total ? card.count / card.total : 0;
  const Icon = card.entityType === "company" ? Building2 : UserRound;

  const enrich = async () => {
    setPending(true);
    const res = await apiFetch<{ enrichment_job: { total: number } }>("/api/v1/enrichment_jobs", {
      body: { kind: "records", segment: card.segment },
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Queued ${num(res.data.enrichment_job.total)} records for enrichment.`);
    router.refresh();
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden="true" />
          {card.label}
        </CardDescription>
        <CardTitle className="font-medium font-mono text-2xl tabular-nums">
          {num(card.count)}
          <span className="ml-1 font-normal text-muted-foreground text-sm">of {num(card.total)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        <p className="text-muted-foreground text-xs">{card.description}</p>
      </CardContent>
      {canEnrich ? (
        <CardFooter>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || card.count === 0}
            onClick={enrich}
            aria-label={`Enrich now: ${card.label}`}
          >
            <Sparkles data-icon="inline-start" aria-hidden="true" />
            {pending ? "Queuing…" : "Enrich now"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function HealthCenter({
  health,
  duplicates,
  permissions,
}: {
  health: DataHealth;
  duplicates: DuplicateGroup[];
  permissions: EnrichmentPermissions;
}) {
  const dupes = health.duplicates.contacts + health.duplicates.companies;
  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="People" value={num(health.contacts)} />
        <Kpi label="Companies" value={num(health.companies)} />
        <Kpi label="Verified emails" value={percent(health.verifiedRate)} hint="Of people with an email address" />
        <Kpi
          label="Possible duplicates"
          value={num(dupes)}
          hint={`${health.duplicates.contacts} people · ${health.duplicates.companies} companies`}
        />
      </div>

      <section aria-labelledby="enrichable-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="enrichable-heading" className="font-medium text-base">
            Enrichable data
          </h2>
          <p className="text-muted-foreground text-sm">
            Gaps found in your records. Enriching never overwrites a value with a less certain one.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {health.cards.map((card) => (
            <EnrichableCard key={card.segment} card={card} canEnrich={permissions.enrich} />
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-5">
        <DuplicatesCard
          className="xl:col-span-3"
          initialGroups={duplicates}
          canMergeContacts={permissions.mergeContacts}
          canMergeCompanies={permissions.mergeCompanies}
          icon={<Copy className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
        <ActivityCard className="xl:col-span-2" activity={health.activity} />
      </div>
    </div>
  );
}
