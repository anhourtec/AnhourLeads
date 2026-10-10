import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeft, Building2, Mail, ShieldBan } from "lucide-react";
import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/rbac/permissions";
import { CONTACT_STAGE_LABELS, EMAIL_STATUS_LABELS, SENIORITY_LABELS } from "@/lib/records-vocabulary";
import { HttpError } from "@/server/http/errors";
import { companyOptions } from "@/server/services/companies";
import { contactProvenance, getContact } from "@/server/services/contacts";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";

import { PageHeader } from "../../_components/records/page-header";
import { DetailField, latestByField } from "../../_components/records/provenance";
import { ContactStagePill, EmailStatusPill, SuppressedPill } from "../../_components/records/status-pills";
import { PersonFormDialog } from "../_components/person-form-dialog";
import { DeletePersonButton } from "./_components/delete-person-button";

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

export default async function PersonPage({ params }: { params: Params }) {
  const { actor, person, provenance: rows } = await load((await params).id);
  const provenance = latestByField(rows);
  const canUpdate = can(actor.role, "contact:update");
  const canDelete = can(actor.role, "contact:delete");
  const [members, companies] = canUpdate
    ? await Promise.all([workspaceMembers(actor), companyOptions(actor)])
    : [[], []];

  const subtitle = [person.title, person.company?.name].filter(Boolean).join(" at ");

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard/people">
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            People
          </Link>
        </Button>
      </div>
      <PageHeader
        title={person.name}
        description={
          <div className="flex flex-col gap-2">
            {subtitle ? <span>{subtitle}</span> : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <ContactStagePill stage={person.stage} />
              {person.email ? <EmailStatusPill status={person.emailStatus} /> : null}
              {person.suppressed ? <SuppressedPill /> : null}
            </div>
          </div>
        }
        actions={
          <>
            {canUpdate ? (
              <PersonFormDialog
                person={person}
                members={members.map((m) => ({ id: m.id, name: m.name }))}
                companies={companies}
              />
            ) : null}
            {canDelete ? <DeletePersonButton id={person.id} name={person.name} /> : null}
          </>
        }
      />

      {person.suppressed ? (
        <Alert variant="destructive">
          <ShieldBan aria-hidden="true" />
          <AlertTitle>On the do-not-contact list</AlertTitle>
          <AlertDescription>
            This email or its domain is suppressed. Sequences skip this person and no email will be sent to them.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:gap-6 xl:grid-cols-3">
        <Card className="gap-4 xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-medium text-base">
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              Contact details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <DetailField label="Email" mono provenance={provenance.get("email")}>
                {person.email ? (
                  <a href={`mailto:${person.email}`} className="underline-offset-4 hover:underline">
                    {person.email}
                  </a>
                ) : null}
              </DetailField>
              <DetailField label="Email status" provenance={provenance.get("emailStatus")}>
                {person.email ? EMAIL_STATUS_LABELS[person.emailStatus] : null}
              </DetailField>
              <DetailField label="Phone" mono provenance={provenance.get("phone")}>
                {person.phone}
              </DetailField>
              <DetailField label="LinkedIn" mono provenance={provenance.get("linkedinUrl")}>
                {person.linkedinUrl ? (
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-4 hover:underline"
                  >
                    {person.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : null}
              </DetailField>
              <DetailField label="Title" provenance={provenance.get("title")}>
                {person.title}
              </DetailField>
              <DetailField label="Seniority" provenance={provenance.get("seniority")}>
                {person.seniority ? SENIORITY_LABELS[person.seniority] : null}
              </DetailField>
              <DetailField label="Department" provenance={provenance.get("department")}>
                {person.department}
              </DetailField>
              <DetailField label="City" provenance={provenance.get("city")}>
                {person.city}
              </DetailField>
              <DetailField label="State or region" provenance={provenance.get("state")}>
                {person.state}
              </DetailField>
              <DetailField label="Country" provenance={provenance.get("country")}>
                {person.country}
              </DetailField>
              <DetailField label="Time zone" provenance={provenance.get("timezone")}>
                {person.timezone}
              </DetailField>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 md:gap-6">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-medium text-base">
                <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                Company
              </CardTitle>
            </CardHeader>
            <CardContent>
              {person.company ? (
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={`/dashboard/companies/${person.company.id}`}
                    className="font-medium text-sm underline-offset-4 hover:underline"
                  >
                    {person.company.name}
                  </Link>
                  {person.company.domain ? (
                    <span className="font-mono text-muted-foreground text-xs">{person.company.domain}</span>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Not linked to a company.</p>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="font-medium text-base">Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4">
                <DetailField label="Stage" provenance={provenance.get("stage")}>
                  {CONTACT_STAGE_LABELS[person.stage]}
                </DetailField>
                <DetailField label="Owner" provenance={provenance.get("ownerId")}>
                  {person.owner?.name}
                </DetailField>
                <DetailField label="Tags" provenance={provenance.get("tags")}>
                  {person.tags.length ? (
                    <span className="flex flex-wrap gap-1">
                      {person.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </DetailField>
                <DetailField label="Consent basis" provenance={provenance.get("consentBasis")}>
                  {person.consentBasis?.replaceAll("_", " ")}
                </DetailField>
                <DetailField label="Added from">
                  <span className="font-mono text-xs">{person.source}</span>
                </DetailField>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
