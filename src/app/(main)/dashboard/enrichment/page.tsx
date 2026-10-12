import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom } from "@/server/http/route";
import { log } from "@/server/log";
import { findDuplicates, findJobChanges, getDataHealth } from "@/server/services/data-health";
import { activeJobs, getAutomation, listEnrichmentJobs } from "@/server/services/enrichment-jobs";

import { ErrorState } from "../_components/pipeline/error-state";
import { EnrichmentScreen } from "./_components/enrichment-screen";

export const metadata: Metadata = { title: "Data enrichment" };

const TABS = ["health", "csv", "job-changes", "research"] as const;
type Tab = (typeof TABS)[number];

export default async function EnrichmentPage({ searchParams }: PageProps<"/dashboard/enrichment">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "contact:read")) notFound();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "health";

  const loaded = await Promise.all([
    getDataHealth(actor),
    findDuplicates(actor, 50),
    findJobChanges(actor),
    listEnrichmentJobs(actor, pageFrom({ per_page: 10 }), { kind: "csv" }),
    activeJobs(actor),
    getAutomation(actor),
  ]).catch((error: unknown) => {
    log.error("data enrichment failed to load", { component: "enrichment", error });
    return null;
  });
  if (!loaded) return <ErrorState title="Data enrichment couldn't load" />;
  const [health, duplicates, jobChanges, csvJobs, active, automation] = loaded;

  return (
    <EnrichmentScreen
      initialTab={tab}
      health={health}
      duplicates={duplicates}
      jobChanges={jobChanges}
      csvJobs={csvJobs.jobs}
      activeJobs={active}
      automation={automation}
      permissions={{
        enrich: can(actor.role, "enrich:run"),
        createContacts: can(actor.role, "contact:create"),
        updateContacts: can(actor.role, "contact:update"),
        mergeContacts: can(actor.role, "contact:delete") && can(actor.role, "contact:update"),
        mergeCompanies: can(actor.role, "company:delete") && can(actor.role, "company:update"),
        research: can(actor.role, "crawler:read"),
      }}
    />
  );
}
