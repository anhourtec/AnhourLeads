import "server-only";

import { apollo } from "./apollo";
import { hunter } from "./hunter";
import { peopleDataLabs } from "./people-data-labs";
import type { ProviderClient, ProviderId } from "./types";

export * from "./types";

/** A client for one provider and one workspace's key. */
export function providerClient(provider: ProviderId, apiKey: string): ProviderClient {
  if (provider === "people_data_labs") return peopleDataLabs(apiKey);
  if (provider === "apollo") return apollo(apiKey);
  return hunter(apiKey);
}

/** The fixed order providers are tried in: fuller profiles first, Hunter last (email only). */
export const PROVIDER_ORDER: readonly ProviderId[] = ["people_data_labs", "apollo", "hunter"];
