import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeRemovalRequest } from "@/server/discovery/removal";

import { ConfirmRemoval } from "../../_components/confirm-removal";

export const metadata: Metadata = { title: "Confirm removal", robots: { index: false } };

/**
 * The emailed link: `/privacy/removal/confirm/<token>.<secret>`. Opening it changes nothing; the
 * button does, so link scanners in mail systems can't confirm a request by themselves.
 */
export default async function ConfirmRemovalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [token = "", secret = ""] = code.split(".");
  const request = await describeRemovalRequest(token);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Confirm removal</h1>
      {request && secret ? (
        <ConfirmRemoval token={token} secret={secret} kind={request.kind} value={request.value} />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>This link isn't valid</AlertTitle>
          <AlertDescription>
            It may have expired (links work for 7 days) or been used already. You can send a new request from the
            removal page.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
