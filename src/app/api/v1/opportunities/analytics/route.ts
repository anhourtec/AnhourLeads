import { route } from "@/server/http/route";
import { dealAnalytics, dealAnalyticsSchema } from "@/server/services/deals";

export const GET = route(
  async ({ req, actor }) =>
    dealAnalytics(
      actor,
      dealAnalyticsSchema.parse({ pipelineId: req.nextUrl.searchParams.get("pipelineId") ?? undefined }),
    ),
  { permission: "deal:read" },
);
