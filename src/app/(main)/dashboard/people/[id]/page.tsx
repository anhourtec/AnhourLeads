import Link from "next/link";
import { notFound } from "next/navigation";

import { and, asc, desc, eq } from "drizzle-orm";
import { Plus, ShieldBan } from "lucide-react";
import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/rbac/permissions";
import {
  COMPANY_STAGE_LABELS,
  CONTACT_STAGE_LABELS,
  EMAIL_STATUS_LABELS,
  FIELD_LABELS,
  SENIORITY_LABELS,
} from "@/lib/records-vocabulary";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";
import { pageFrom } from "@/server/http/route";
import { type CompanyDto, companyOptions, getCompany } from "@/server/services/companies";
import { contactProvenance, getContact } from "@/server/services/contacts";
import { listCustomFields } from "@/server/services/custom-fields";
import { dealsForContact } from "@/server/services/deals";
import { listNotes } from "@/server/services/notes";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";
import { searchTasks, taskSearchSchema } from "@/server/services/tasks";

import { DetailField, latestByField, ProvenanceLine } from "../../_components/records/provenance";
import { CompanyStagePill, ContactStagePill, EmailStatusPill } from "../../_components/records/status-pills";
import {
  AccessEmailButton,
  AddTaskButton,
  LocalTime,
  SeeAllFieldsButton,
  StageSelect,
} from "./_components/card-controls";
import { ContactHeader } from "./_components/contact-header";
import { CardColumn, ContactLayoutProvider } from "./_components/contact-layout";
import { ContactTabs } from "./_components/contact-tabs";
import { NotesCard } from "./_components/notes-card";
import { CompanyInsights, MonoLabel } from "./_components/prospect";

type Params = Promise<{ id: string }>;

async function load(id: string) {
  const { actor } = await recordsPageActor("contact:read");
  try {
    const [person, provenance] = await Promise.all([getContact(actor, id), contactProvenance(actor, id)]);
    return { actor, person, provenance };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { person } = await load((await params).id);
  return { title: person.name };
}

const ENROLLMENT_TONES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  finished: "bg-muted text-muted-foreground",
  replied: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  bounced: "bg-destructive/10 text-destructive",
  unsubscribed: "bg-destructive/10 text-destructive",
  removed: "bg-muted text-muted-foreground",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function PersonPage({ params }: { params: Params }) {
  const { actor, person, provenance: rows } = await load((await params).id);
  const provenance = latestByField(rows);
  const org = actor.organizationId;
  const perms = {
    update: can(actor.role, "contact:update"),
    delete: can(actor.role, "contact:delete"),
    createTask: can(actor.role, "task:create"),
    addToList: can(actor.role, "list:update"),
    createList: can(actor.role, "list:create"),
    enroll: can(actor.role, "sequence:launch"),
    enrich: can(actor.role, "enrich:run"),
    noteCreate: can(actor.role, "note:create"),
    noteDelete: can(actor.role, "note:delete"),
    createDeal: can(actor.role, "deal:create"),
  };

  const [company, lists, deals, tasks, enrollments, customFields, notes, members, companies] = await Promise.all([
    person.companyId ? getCompany(actor, person.companyId).catch(() => null) : Promise.resolve<CompanyDto | null>(null),
    db
      .select({ id: schema.list.id, name: schema.list.name })
      .from(schema.listMember)
      .innerJoin(schema.list, eq(schema.list.id, schema.listMember.listId))
      .where(
        and(
          eq(schema.listMember.entityId, person.id),
          eq(schema.list.organizationId, org),
          eq(schema.list.entityType, "contact"),
        ),
      )
      .orderBy(asc(schema.list.name)),
    dealsForContact(actor, person.id),
    searchTasks(
      actor,
      taskSearchSchema.parse({ contactId: person.id, status: "open" }),
      pageFrom({ page: 1, per_page: 20 }),
    ),
    db
      .select({
        id: schema.enrollment.id,
        status: schema.enrollment.status,
        currentStep: schema.enrollment.currentStep,
        createdAt: schema.enrollment.createdAt,
        sequenceId: schema.sequence.id,
        sequenceName: schema.sequence.name,
        sequenceStatus: schema.sequence.status,
      })
      .from(schema.enrollment)
      .innerJoin(schema.sequence, eq(schema.sequence.id, schema.enrollment.sequenceId))
      .where(and(eq(schema.enrollment.organizationId, org), eq(schema.enrollment.contactId, person.id)))
      .orderBy(desc(schema.enrollment.createdAt)),
    listCustomFields(actor, "contact"),
    listNotes(actor, { entityType: "contact", entityId: person.id }),
    perms.update ? workspaceMembers(actor) : Promise.resolve([]),
    perms.update ? companyOptions(actor) : Promise.resolve([]),
  ]);

  const emailSource = provenance.get("email")?.source ?? person.source;
  const doNotContact = person.suppressed || person.stage === "do_not_contact";
  // Compose through a connected mailbox so the email carries unsubscribe and sender details.
  const emailHref = person.email && !doNotContact ? `/dashboard/emails/new?to=${person.id}` : null;
  const location = [person.city, person.state, person.country].filter(Boolean).join(", ");

  const standardFields: { key: string; label: string; value: React.ReactNode; mono?: boolean }[] = [
    { key: "firstName", label: FIELD_LABELS.firstName, value: person.firstName },
    { key: "lastName", label: FIELD_LABELS.lastName, value: person.lastName },
    { key: "email", label: FIELD_LABELS.email, value: person.email, mono: true },
    { key: "emailStatus", label: "Email status", value: person.email ? EMAIL_STATUS_LABELS[person.emailStatus] : null },
    { key: "title", label: FIELD_LABELS.title, value: person.title },
    {
      key: "seniority",
      label: FIELD_LABELS.seniority,
      value: person.seniority ? SENIORITY_LABELS[person.seniority] : null,
    },
    { key: "department", label: FIELD_LABELS.department, value: person.department },
    { key: "phone", label: FIELD_LABELS.phone, value: person.phone, mono: true },
    { key: "linkedinUrl", label: FIELD_LABELS.linkedinUrl, value: person.linkedinUrl, mono: true },
    { key: "city", label: FIELD_LABELS.city, value: person.city },
    { key: "state", label: FIELD_LABELS.state, value: person.state },
    { key: "country", label: FIELD_LABELS.country, value: person.country },
    { key: "timezone", label: FIELD_LABELS.timezone, value: person.timezone },
    { key: "companyId", label: FIELD_LABELS.companyId, value: person.company?.name },
    { key: "stage", label: FIELD_LABELS.stage, value: CONTACT_STAGE_LABELS[person.stage] },
    { key: "ownerId", label: FIELD_LABELS.ownerId, value: person.owner?.name },
    { key: "tags", label: FIELD_LABELS.tags, value: person.tags.length ? person.tags.join(", ") : null },
    { key: "consentBasis", label: FIELD_LABELS.consentBasis, value: person.consentBasis?.replaceAll("_", " ") },
  ];
  const fieldCount = standardFields.length + customFields.length;

  const contactCard = (
    <div className="flex flex-col gap-4">
      {doNotContact ? (
        <Alert variant="destructive">
          <ShieldBan aria-hidden="true" />
          <AlertTitle>Do not contact</AlertTitle>
          <AlertDescription>
            {person.suppressed
              ? "This email or its domain is on the do-not-contact list. Sequences skip this person."
              : "The stage is set to do not contact. Sequences skip this person."}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1">
        {person.email ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <a
                href={`mailto:${person.email}`}
                className="break-all font-mono text-sm underline-offset-4 hover:underline"
              >
                {person.email}
              </a>
              <Badge variant="outline" className="font-normal">
                Primary
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              Business · Source: <span className="font-mono">{emailSource}</span> ·{" "}
              {EMAIL_STATUS_LABELS[person.emailStatus]}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No email address yet.</p>
        )}
        {perms.enrich && perms.update && (!person.email || person.emailStatus === "unverified") ? (
          <div className="pt-1">
            <AccessEmailButton contactId={person.id} hasEmail={Boolean(person.email)} />
          </div>
        ) : null}
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
        <MonoLabel>Phone</MonoLabel>
        <dd className="min-w-0 break-words">
          {person.phone ? (
            <a href={`tel:${person.phone}`} className="font-mono underline-offset-4 hover:underline">
              {person.phone}
            </a>
          ) : (
            <span className="text-muted-foreground">No phone number</span>
          )}
        </dd>
        <MonoLabel>Local time</MonoLabel>
        <dd className="min-w-0">
          <LocalTime timezone={person.timezone} />
        </dd>
        <MonoLabel>Social</MonoLabel>
        <dd className="min-w-0 break-all">
          {person.linkedinUrl ? (
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs underline-offset-4 hover:underline"
            >
              {person.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          ) : (
            <span className="text-muted-foreground">No profiles</span>
          )}
        </dd>
      </dl>
    </div>
  );

  const recordCard = (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">
      <MonoLabel>Stage</MonoLabel>
      <dd className="min-w-0">
        {perms.update ? (
          <StageSelect contactId={person.id} stage={person.stage} />
        ) : (
          <ContactStagePill stage={person.stage} />
        )}
      </dd>
      <MonoLabel>Lists</MonoLabel>
      <dd className="flex min-w-0 flex-wrap gap-1">
        {lists.length ? (
          lists.map((l) => (
            <Badge key={l.id} variant="secondary" asChild className="font-normal">
              <Link href={`/dashboard/lists/${l.id}`}>{l.name}</Link>
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">Not in any list</span>
        )}
      </dd>
      <MonoLabel>Last activity</MonoLabel>
      <dd className="min-w-0">
        {formatDate(person.lastActivityAt) ?? <span className="text-muted-foreground">None yet</span>}
      </dd>
      <MonoLabel>Owner</MonoLabel>
      <dd className="min-w-0">{person.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}</dd>
      <MonoLabel>Email status</MonoLabel>
      <dd className="min-w-0">{person.email ? <EmailStatusPill status={person.emailStatus} /> : "—"}</dd>
      <dd className="col-span-2">
        <SeeAllFieldsButton count={fieldCount} />
      </dd>
    </dl>
  );

  const accountCard = company ? (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted font-medium font-mono text-xs"
        >
          {company.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/dashboard/companies/${company.id}`}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {company.name}
          </Link>
          {company.domain ? (
            <a
              href={company.websiteUrl ?? `https://${company.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate font-mono text-muted-foreground text-xs underline-offset-4 hover:underline"
            >
              {company.domain}
            </a>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <MonoLabel>Stage</MonoLabel>
        <dd>
          <CompanyStagePill stage={company.stage} />
        </dd>
        <MonoLabel>Owner</MonoLabel>
        <dd>{company.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}</dd>
        <MonoLabel>Employees</MonoLabel>
        <dd className="font-mono tabular-nums">
          {company.employeeCount?.toLocaleString("en-US") ?? (
            <span className="font-sans text-muted-foreground">Unknown</span>
          )}
        </dd>
      </dl>
    </div>
  ) : (
    <p className="text-muted-foreground text-sm">Not linked to a company.</p>
  );

  const dealHref = `/dashboard/deals?new=1&contactId=${person.id}${person.companyId ? `&companyId=${person.companyId}` : ""}`;
  const dealsCard = (
    <div className="flex flex-col gap-2 text-sm">
      {deals.length ? (
        <ul className="flex flex-col gap-2">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{d.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
                {d.amount !== null ? (
                  <span className="font-mono tabular-nums">
                    {d.amount.toLocaleString("en-US")} {d.currency}
                  </span>
                ) : null}
                <Badge variant="secondary" className="font-normal">
                  {d.stageName}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No deals yet.</p>
      )}
    </div>
  );

  const tasksCard = tasks.tasks.length ? (
    <ul className="flex flex-col gap-2 text-sm">
      {tasks.tasks.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2">
          <Link href="/dashboard/tasks" className="min-w-0 truncate underline-offset-4 hover:underline">
            {t.title}
          </Link>
          <span className="shrink-0 text-muted-foreground text-xs">
            {t.dueAt ? `Due ${formatDate(t.dueAt)}` : "No due date"}
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground text-sm">No open tasks.</p>
  );

  const sequencesTab = enrollments.length ? (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-4 py-2 font-mono font-normal text-[11px] text-muted-foreground uppercase tracking-wider">
              Sequence
            </th>
            <th className="px-4 py-2 font-mono font-normal text-[11px] text-muted-foreground uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-2 font-mono font-normal text-[11px] text-muted-foreground uppercase tracking-wider">
              Step
            </th>
            <th className="px-4 py-2 font-mono font-normal text-[11px] text-muted-foreground uppercase tracking-wider">
              Added
            </th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => (
            <tr key={e.id} className="border-b last:border-0">
              <td className="px-4 py-2.5">
                <Link href={`/dashboard/sequences/${e.sequenceId}`} className="underline-offset-4 hover:underline">
                  {e.sequenceName}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <Badge variant="secondary" className={`font-medium ${ENROLLMENT_TONES[e.status] ?? ""}`}>
                  {e.status.charAt(0).toUpperCase() + e.status.slice(1)}
                </Badge>
              </td>
              <td className="px-4 py-2.5 font-mono tabular-nums">{e.currentStep + 1}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                {formatDate(e.createdAt.toISOString())}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
      Not in any sequence yet.
    </p>
  );

  const fieldsTab = (
    <div className="flex flex-col gap-6 rounded-xl border p-4 md:p-6">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {standardFields.map((f) => (
          <DetailField key={f.key} label={f.label} mono={f.mono} provenance={provenance.get(f.key)}>
            {f.value}
          </DetailField>
        ))}
      </dl>
      <div className="flex flex-col gap-3">
        <h3 className="font-medium text-sm">Custom fields</h3>
        {customFields.length ? (
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {customFields.map((f) => {
              const raw = person.customFields[f.key];
              let value: React.ReactNode = null;
              if (raw !== undefined && raw !== null && raw !== "") {
                if (f.type !== "boolean") value = String(raw);
                else value = raw ? "Yes" : "No";
              }
              return (
                <DetailField
                  key={f.id}
                  label={f.label}
                  mono={f.type === "url"}
                  provenance={provenance.get(`cf.${f.key}`)}
                >
                  {value}
                </DetailField>
              );
            })}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            This workspace has no custom fields for people.
            {can(actor.role, "customfield:manage") ? (
              <>
                {" "}
                <Link
                  href="/dashboard/settings/custom-fields"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Add one
                </Link>
                .
              </>
            ) : null}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-sm">Added from</h3>
        <p className="font-mono text-xs">{person.source}</p>
        <ProvenanceLine entry={provenance.get("firstName") ?? provenance.get("email")} />
      </div>
    </div>
  );

  return (
    <ContactLayoutProvider>
      <div className="flex min-w-0 flex-col gap-4 md:gap-6">
        <ContactHeader
          person={person}
          permissions={perms}
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          companies={companies}
          emailHref={emailHref}
        />
        <div className="grid min-w-0 gap-4 md:gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <CardColumn
            cards={{
              contact: { body: contactCard },
              record: { body: recordCard },
              account: { body: accountCard },
              deals: {
                body: dealsCard,
                action: perms.createDeal ? (
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Add deal">
                    <Link href={dealHref}>
                      <Plus aria-hidden="true" />
                    </Link>
                  </Button>
                ) : undefined,
              },
              notes: {
                body: (
                  <NotesCard
                    contactId={person.id}
                    notes={notes}
                    canCreate={perms.noteCreate}
                    canDeleteAny={perms.noteDelete}
                    userId={actor.userId}
                  />
                ),
              },
              tasks: {
                body: tasksCard,
                action: perms.createTask ? (
                  <AddTaskButton contactId={person.id} companyId={person.companyId} personName={person.name} />
                ) : undefined,
              },
            }}
          />
          <ContactTabs
            contactId={person.id}
            sequenceCount={enrollments.length}
            prospect={
              <CompanyInsights
                company={company}
                location={location}
                companyStageLabel={company ? COMPANY_STAGE_LABELS[company.stage] : null}
              />
            }
            sequences={sequencesTab}
            fields={fieldsTab}
          />
        </div>
      </div>
    </ContactLayoutProvider>
  );
}
