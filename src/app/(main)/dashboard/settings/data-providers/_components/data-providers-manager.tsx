import { ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { DataProviderDto } from "@/server/services/data-providers";

import { PageHeader } from "../../../_components/pipeline/page-header";
import { ProviderCard } from "./provider-card";
import { PROVIDERS } from "./provider-catalog";

export function DataProvidersManager({
  providers,
  now,
}: {
  readonly providers: DataProviderDto[];
  readonly now: string;
}) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Data providers"
        description="Connect your own account with an outside data provider to fill the gaps the shared index, website research and email patterns leave. Enrichment tries enabled providers in the order shown and only fills empty fields."
      />
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>Results stay in this workspace</AlertTitle>
        <AlertDescription>
          What a provider returns is saved only to this workspace's people and companies, marked with the provider as
          its source. It never goes into the shared index other workspaces search. Your workspace holds the licence, so
          you're responsible for following the provider's terms and paying for the credits your lookups use.
        </AlertDescription>
      </Alert>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {PROVIDERS.map((info) => (
          <ProviderCard
            key={info.id}
            info={info}
            connection={providers.find((p) => p.provider === info.id) ?? null}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}
