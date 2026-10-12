import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getCompany } from "@/server/services/companies";
import { companyInsights } from "@/server/services/company-insights";
import { searchContacts } from "@/server/services/contacts";
import { orNotFound } from "@/server/services/engage-context";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";

import { CompanyProfile } from "../../_components/records/search/company-profile";
import { CompanyFormDialog } from "../_components/company-form-dialog";
import { DeleteCompanyButton } from "./_components/delete-company-button";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { actor } = await recordsPageActor("company:read");
  const company = await orNotFound(getCompany(actor, (await params).id));
  return { title: company.name };
}

export default async function CompanyPage({ params }: { params: Params }) {
  const { actor } = await recordsPageActor("company:read");
  const { id } = await params;
  const [company, insights, people] = await Promise.all([
    orNotFound(getCompany(actor, id)),
    companyInsights(actor, id),
    searchContacts(actor, { companyId: id }, { page: 1, perPage: 50, offset: 0 }),
  ]);
  const canUpdate = can(actor.role, "company:update");
  const canDelete = can(actor.role, "company:delete");
  const members = canUpdate ? await workspaceMembers(actor) : [];

  return (
    <CompanyProfile
      variant="page"
      currentUserId={actor.userId ?? ""}
      data={{ company, insights, people: people.contacts, peopleTotal: people.pagination.total_entries }}
      permissions={{
        update: canUpdate,
        listUpdate: can(actor.role, "list:update"),
        listCreate: can(actor.role, "list:create"),
      }}
      extraActions={
        <>
          {canUpdate ? (
            <CompanyFormDialog company={company} members={members.map((m) => ({ id: m.id, name: m.name }))} />
          ) : null}
          {canDelete ? (
            <DeleteCompanyButton id={company.id} name={company.name} peopleCount={company.contactCount} />
          ) : null}
        </>
      }
    />
  );
}
