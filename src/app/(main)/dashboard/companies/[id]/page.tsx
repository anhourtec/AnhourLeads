import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeft, Building2, ShieldBan, Users } from "lucide-react";
import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/rbac/permissions";
import { COMPANY_STAGE_LABELS } from "@/lib/records-vocabulary";
import { HttpError } from "@/server/http/errors";
import { companyOptions, companyProvenance, getCompany } from "@/server/services/companies";
import { searchContacts } from "@/server/services/contacts";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";

import { PageHeader } from "../../_components/records/page-header";
import { DetailField, latestByField } from "../../_components/records/provenance";
import {
  CompanyStagePill,
  ContactStagePill,
  EmailStatusPill,
  SuppressedPill,
} from "../../_components/records/status-pills";
import { PersonFormDialog } from "../../people/_components/person-form-dialog";
import { CompanyFormDialog } from "../_components/company-form-dialog";
import { DeleteCompanyButton } from "./_components/delete-company-button";

type Params = Promise<{ id: string }>;
const PEOPLE_LIMIT = 50;

async function load(id: string) {
  const { actor } = await recordsPageActor("company:read");
  try {
    const [company, provenance] = await Promise.all([getCompany(actor, id), companyProvenance(actor, id)]);
    return { actor, company, provenance };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { company } = await load((await params).id);
  return { title: company.name };
}

const formatNumber = (n: number | null) => (n === null ? null : n.toLocaleString("en-US"));

export default async function CompanyPage({ params }: { params: Params }) {
  const { actor, company, provenance: rows } = await load((await params).id);
  const provenance = latestByField(rows);
  const canUpdate = can(actor.role, "company:update");
  const canDelete = can(actor.role, "company:delete");
  const canAddPerson = can(actor.role, "contact:create");
  const canReadPeople = can(actor.role, "contact:read");

  const [people, members, companies] = await Promise.all([
    canReadPeople
      ? searchContacts(
          actor,
          { companyId: company.id, sortBy: "name", sortAscending: true },
          {
            page: 1,
            perPage: PEOPLE_LIMIT,
            offset: 0,
          },
        )
      : null,
    canUpdate || canAddPerson ? workspaceMembers(actor) : Promise.resolve([]),
    canAddPerson ? companyOptions(actor) : Promise.resolve([]),
  ]);
  const peopleTotal = people?.pagination.total_entries ?? 0;
  const location = [company.city, company.state, company.country].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard/companies">
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Companies
          </Link>
        </Button>
      </div>
      <PageHeader
        title={company.name}
        description={
          <div className="flex flex-col gap-2">
            {company.domain || location ? (
              <span className="flex flex-wrap items-center gap-x-2">
                {company.domain ? <span className="font-mono">{company.domain}</span> : null}
                {company.domain && location ? <span aria-hidden="true">·</span> : null}
                {location ? <span>{location}</span> : null}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <CompanyStagePill stage={company.stage} />
              {company.suppressed ? <SuppressedPill /> : null}
            </div>
          </div>
        }
        actions={
          <>
            {canUpdate ? <CompanyFormDialog company={company} members={members} /> : null}
            {canDelete ? (
              <DeleteCompanyButton id={company.id} name={company.name} peopleCount={company.contactCount} />
            ) : null}
          </>
        }
      />

      {company.suppressed ? (
        <Alert variant="destructive">
          <ShieldBan aria-hidden="true" />
          <AlertTitle>Domain on the do-not-contact list</AlertTitle>
          <AlertDescription>
            Nobody at <span className="font-mono">{company.domain}</span> will be enrolled in sequences or emailed.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:gap-6 xl:grid-cols-3">
        <Card className="gap-4 xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-medium text-base">
              <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
              Company details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <DetailField label="Domain" mono provenance={provenance.get("domain")}>
                {company.domain}
              </DetailField>
              <DetailField label="Website" mono provenance={provenance.get("websiteUrl")}>
                {company.websiteUrl ? (
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-4 hover:underline"
                  >
                    {company.websiteUrl.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </DetailField>
              <DetailField label="Industry" provenance={provenance.get("industry")}>
                {company.industry}
              </DetailField>
              <DetailField label="Employees" mono provenance={provenance.get("employeeCount")}>
                {formatNumber(company.employeeCount)}
              </DetailField>
              <DetailField label="Annual revenue" mono provenance={provenance.get("annualRevenue")}>
                {company.annualRevenue === null ? null : `$${formatNumber(company.annualRevenue)}`}
              </DetailField>
              <DetailField label="Founded" mono provenance={provenance.get("foundedYear")}>
                {company.foundedYear?.toString()}
              </DetailField>
              <DetailField label="Phone" mono provenance={provenance.get("phone")}>
                {company.phone}
              </DetailField>
              <DetailField label="LinkedIn" mono provenance={provenance.get("linkedinUrl")}>
                {company.linkedinUrl ? (
                  <a
                    href={company.linkedinUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-4 hover:underline"
                  >
                    {company.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : null}
              </DetailField>
              <DetailField label="City" provenance={provenance.get("city")}>
                {company.city}
              </DetailField>
              <DetailField label="Country" provenance={provenance.get("country")}>
                {company.country}
              </DetailField>
              <DetailField label="Technologies" provenance={provenance.get("technologies")}>
                {company.technologies.length ? (
                  <span className="flex flex-wrap gap-1">
                    {company.technologies.map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">
                        {t}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </DetailField>
              <DetailField label="Keywords" provenance={provenance.get("keywords")}>
                {company.keywords.length ? company.keywords.join(", ") : null}
              </DetailField>
              <div className="sm:col-span-2">
                <DetailField label="Description" provenance={provenance.get("description")}>
                  {company.description ? <span className="block max-w-prose">{company.description}</span> : null}
                </DetailField>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="font-medium text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <DetailField label="Stage" provenance={provenance.get("stage")}>
                {COMPANY_STAGE_LABELS[company.stage]}
              </DetailField>
              <DetailField label="Owner" provenance={provenance.get("ownerId")}>
                {company.owner?.name}
              </DetailField>
              <DetailField label="Email pattern" mono>
                {company.emailPattern}
              </DetailField>
              <DetailField label="Added from">
                <span className="font-mono text-xs">{company.source}</span>
              </DetailField>
            </dl>
          </CardContent>
        </Card>
      </div>

      {people ? (
        <Card className="gap-4 pb-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-medium text-base">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              People
            </CardTitle>
            <CardDescription>
              <span className="font-mono tabular-nums">{peopleTotal.toLocaleString("en-US")}</span>{" "}
              {peopleTotal === 1 ? "person" : "people"} at {company.name}.
            </CardDescription>
            <CardAction className="flex flex-wrap gap-2">
              {peopleTotal > PEOPLE_LIMIT ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/people?companyId=${company.id}`}>
                    <Users data-icon="inline-start" aria-hidden="true" />
                    View all
                  </Link>
                </Button>
              ) : null}
              {canAddPerson ? (
                <PersonFormDialog
                  members={members.map((m) => ({ id: m.id, name: m.name }))}
                  companies={companies}
                  defaultCompanyId={company.id}
                />
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {people.contacts.length ? (
              <Table className="**:data-[slot=table-cell]:px-4 **:data-[slot=table-head]:px-4">
                <TableHeader className="[&_tr]:border-t">
                  <TableRow>
                    <TableHead className="font-normal text-muted-foreground">Name</TableHead>
                    <TableHead className="font-normal text-muted-foreground">Title</TableHead>
                    <TableHead className="font-normal text-muted-foreground">Email</TableHead>
                    <TableHead className="font-normal text-muted-foreground">Stage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.contacts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="py-2.5 align-top">
                        <Link
                          href={`/dashboard/people/${p.id}`}
                          className="whitespace-nowrap font-medium underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-36 py-2.5 align-top">
                        {p.title ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        {p.email ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-mono text-xs">{p.email}</span>
                            <div className="flex gap-1">
                              <EmailStatusPill status={p.emailStatus} />
                              {p.suppressed ? <SuppressedPill /> : null}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No email</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 align-top">
                        <ContactStagePill stage={p.stage} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty className="mx-4 mb-4 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No people at this company yet</EmptyTitle>
                  <EmptyDescription>
                    Add someone here, or import a CSV with a company or website column.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
