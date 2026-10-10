import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";

import { audit } from "./audit";
import { findSuppressions, normaliseEmail } from "./suppressions";

export const privacyEmailSchema = z.object({ email: z.string().trim().min(1).max(320) });

function parseEmail(raw: string): string {
  const email = normaliseEmail(raw);
  if (!email) {
    throw new HttpError(422, "Some fields are invalid.", [{ path: "email", message: "Enter a valid email address." }]);
  }
  return email;
}

async function contactIdsFor(organizationId: string, email: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, organizationId), sql`lower(${schema.contact.email}) = ${email}`));
  return rows.map((r) => r.id);
}

/**
 * Erasure request: delete every contact with this email and everything attached to them (field
 * provenance, list memberships, enrollments, sent-message log), then keep one suppression row with
 * reason "erasure_request" so the address is never imported or emailed again.
 */
export async function eraseByEmail(actor: Actor, rawEmail: string) {
  const email = parseEmail(rawEmail);
  const orgId = actor.organizationId;

  const result = await db.transaction(async (tx) => {
    const ids = await contactIdsFor(orgId, email);
    let provenance = 0;
    let listMemberships = 0;
    let enrollments = 0;
    if (ids.length) {
      provenance = (
        await tx
          .delete(schema.fieldProvenance)
          .where(
            and(
              eq(schema.fieldProvenance.organizationId, orgId),
              eq(schema.fieldProvenance.entityType, "contact"),
              inArray(schema.fieldProvenance.entityId, ids),
            ),
          )
          .returning({ id: schema.fieldProvenance.id })
      ).length;
      const orgLists = tx.select({ id: schema.list.id }).from(schema.list).where(eq(schema.list.organizationId, orgId));
      listMemberships = (
        await tx
          .delete(schema.listMember)
          .where(and(inArray(schema.listMember.listId, orgLists), inArray(schema.listMember.entityId, ids)))
          .returning({ id: schema.listMember.entityId })
      ).length;
      enrollments = (
        await tx
          .delete(schema.enrollment)
          .where(and(eq(schema.enrollment.organizationId, orgId), inArray(schema.enrollment.contactId, ids)))
          .returning({ id: schema.enrollment.id })
      ).length;
    }
    const messages = (
      await tx
        .delete(schema.outboundMessage)
        .where(
          and(
            eq(schema.outboundMessage.organizationId, orgId),
            sql`lower(${schema.outboundMessage.toEmail}) = ${email}`,
          ),
        )
        .returning({ id: schema.outboundMessage.id })
    ).length;
    const contacts = ids.length
      ? (
          await tx
            .delete(schema.contact)
            .where(and(eq(schema.contact.organizationId, orgId), inArray(schema.contact.id, ids)))
            .returning({ id: schema.contact.id })
        ).length
      : 0;

    const [suppression] = await tx
      .insert(schema.suppression)
      .values({
        organizationId: orgId,
        kind: "email",
        value: email,
        reason: "erasure_request",
        note: null,
        createdById: actor.userId,
      })
      .onConflictDoUpdate({
        target: [schema.suppression.organizationId, schema.suppression.kind, schema.suppression.value],
        set: { reason: "erasure_request", note: null },
      })
      .returning({ id: schema.suppression.id });
    return { suppressionId: suppression.id, deleted: { contacts, provenance, listMemberships, enrollments, messages } };
  });

  // The address itself stays only in the suppression row, never in the audit trail.
  await audit(actor, "privacy.erase", "suppression", result.suppressionId, result.deleted);
  return result;
}

/** Everything held about an email address in this workspace, for a data-subject access request. */
export async function exportByEmail(actor: Actor, rawEmail: string) {
  const email = parseEmail(rawEmail);
  const orgId = actor.organizationId;
  const contacts = await db
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, orgId), sql`lower(${schema.contact.email}) = ${email}`));
  const ids = contacts.map((c) => c.id);
  const companyIds = contacts.flatMap((c) => (c.companyId ? [c.companyId] : []));

  const [companies, provenance, lists, enrollments, tasks, deals, messages, suppressions] = await Promise.all([
    companyIds.length
      ? db
          .select({ id: schema.company.id, name: schema.company.name, domain: schema.company.domain })
          .from(schema.company)
          .where(and(eq(schema.company.organizationId, orgId), inArray(schema.company.id, companyIds)))
      : [],
    ids.length
      ? db
          .select({
            entityId: schema.fieldProvenance.entityId,
            field: schema.fieldProvenance.field,
            value: schema.fieldProvenance.value,
            source: schema.fieldProvenance.source,
            sourceUrl: schema.fieldProvenance.sourceUrl,
            retrievedAt: schema.fieldProvenance.retrievedAt,
          })
          .from(schema.fieldProvenance)
          .where(
            and(
              eq(schema.fieldProvenance.organizationId, orgId),
              eq(schema.fieldProvenance.entityType, "contact"),
              inArray(schema.fieldProvenance.entityId, ids),
            ),
          )
      : [],
    ids.length
      ? db
          .select({ id: schema.list.id, name: schema.list.name, contactId: schema.listMember.entityId })
          .from(schema.listMember)
          .innerJoin(schema.list, eq(schema.list.id, schema.listMember.listId))
          .where(and(eq(schema.list.organizationId, orgId), inArray(schema.listMember.entityId, ids)))
      : [],
    ids.length
      ? db
          .select({
            id: schema.enrollment.id,
            contactId: schema.enrollment.contactId,
            sequence: schema.sequence.name,
            status: schema.enrollment.status,
            createdAt: schema.enrollment.createdAt,
          })
          .from(schema.enrollment)
          .innerJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
          .where(and(eq(schema.enrollment.organizationId, orgId), inArray(schema.enrollment.contactId, ids)))
      : [],
    ids.length
      ? db
          .select({
            id: schema.task.id,
            title: schema.task.title,
            type: schema.task.type,
            status: schema.task.status,
            note: schema.task.note,
            dueAt: schema.task.dueAt,
          })
          .from(schema.task)
          .where(and(eq(schema.task.organizationId, orgId), inArray(schema.task.contactId, ids)))
      : [],
    ids.length
      ? db
          .select({ id: schema.deal.id, name: schema.deal.name, stage: schema.deal.stage })
          .from(schema.deal)
          .where(and(eq(schema.deal.organizationId, orgId), inArray(schema.deal.contactId, ids)))
      : [],
    db
      .select({
        id: schema.outboundMessage.id,
        subject: schema.outboundMessage.subject,
        body: schema.outboundMessage.body,
        status: schema.outboundMessage.status,
        sentAt: schema.outboundMessage.sentAt,
        createdAt: schema.outboundMessage.createdAt,
      })
      .from(schema.outboundMessage)
      .where(
        and(eq(schema.outboundMessage.organizationId, orgId), sql`lower(${schema.outboundMessage.toEmail}) = ${email}`),
      ),
    findSuppressions(orgId, email),
  ]);

  await audit(actor, "privacy.export", "contact", null, { contacts: contacts.length });
  return {
    email,
    generatedAt: new Date().toISOString(),
    contacts,
    companies,
    provenance,
    lists,
    enrollments,
    tasks,
    deals,
    messages,
    suppressions,
  };
}
