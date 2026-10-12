import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { db, schema } from "@/server/db";
import { pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";

import type { Association } from "../../_components/engage/association-picker";
import { PageHeader } from "../../_components/pipeline/page-header";
import { Composer } from "./_components/composer";

export const metadata: Metadata = { title: "New email" };

export default async function NewEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("sequence:launch");
  const to = (await searchParams).to;
  const mailboxes = await listMailboxes(actor);
  let initialTo: Association | null = null;
  if (typeof to === "string" && to) {
    const [row] = await db
      .select({
        id: schema.contact.id,
        firstName: schema.contact.firstName,
        lastName: schema.contact.lastName,
        email: schema.contact.email,
        companyId: schema.contact.companyId,
      })
      .from(schema.contact)
      .where(and(eq(schema.contact.id, to.slice(0, 100)), eq(schema.contact.organizationId, actor.organizationId)))
      .limit(1);
    if (row) {
      initialTo = {
        kind: "contact",
        id: row.id,
        name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "Unnamed contact",
        detail: row.email,
        companyId: row.companyId,
      };
    }
  }
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="New email"
        description="A single email to one contact, sent from your mailbox with your sender details and an unsubscribe link."
      />
      <Composer
        mailboxes={mailboxes.map((m) => ({
          id: m.id,
          email: m.email,
          readyToSend: m.readyToSend,
          issue: m.issues[0] ?? null,
        }))}
        initialTo={initialTo}
      />
    </div>
  );
}
