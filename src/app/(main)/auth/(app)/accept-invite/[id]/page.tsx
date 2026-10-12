import { headers } from "next/headers";

import type { Metadata } from "next";

import { getAuth } from "@/server/auth/auth";
import { getTenantBrand } from "@/server/auth/context";

import { AcceptInvite } from "../../../_components/accept-invite";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ params }: PageProps<"/auth/accept-invite/[id]">) {
  const { id } = await params;
  const { tenant, brand } = await getTenantBrand();
  const session = await getAuth(tenant).api.getSession({ headers: await headers() });
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-medium text-2xl">Join {brand.name}</h1>
        <p className="text-muted-foreground text-sm">You've been invited to a workspace.</p>
      </div>
      <AcceptInvite invitationId={id} signedIn={Boolean(session)} />
    </div>
  );
}
