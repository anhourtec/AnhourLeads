import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { testDataProvider } from "@/server/services/data-providers";

/**
 * One call to the provider that spends no lookup credits (PDL autocomplete, Apollo auth health,
 * Hunter account). Answers 200 with `ok` and a plain `error`; the outcome is kept as lastError.
 */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => {
    const { ok, error, dataProvider } = await testDataProvider(actor, params.id);
    return { ok, error, data_provider: dataProvider };
  },
  { permission: "provider:manage", limit: LIMITS.sensitive },
);
