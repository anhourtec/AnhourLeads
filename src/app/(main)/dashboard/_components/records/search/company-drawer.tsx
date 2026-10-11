"use client";

import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompanyDto } from "@/server/services/companies";
import type { CompanyInsights } from "@/server/services/company-insights";
import type { ContactDto } from "@/server/services/contacts";

import { apiRequest } from "../api-client";
import { CompanyProfile, type CompanyProfileData, type CompanyProfilePermissions } from "./company-profile";

/** Right-hand sheet with the company profile, opened from any company link in search results. */
export function CompanyDrawer({
  companyId,
  onClose,
  permissions,
  currentUserId,
}: {
  companyId: string | null;
  onClose: () => void;
  permissions: CompanyProfilePermissions;
  currentUserId: string;
}) {
  const [data, setData] = useState<CompanyProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setData(null);
    setError(null);
    void Promise.all([
      apiRequest<{ account: CompanyDto }>(`/api/v1/accounts/${companyId}`),
      apiRequest<CompanyInsights>(`/api/v1/accounts/${companyId}/insights`),
      apiRequest<{ contacts: ContactDto[]; pagination: { total_entries: number } }>("/api/v1/contacts/search", {
        body: { companyId, per_page: 50 },
      }),
    ]).then(([company, insights, people]) => {
      if (cancelled) return;
      if (!company.ok) return setError(company.error);
      if (!insights.ok) return setError(insights.error);
      setData({
        company: company.data.account,
        insights: insights.data,
        people: people.ok ? people.data.contacts : [],
        peopleTotal: people.ok ? people.data.pagination.total_entries : 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <Sheet open={Boolean(companyId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full overflow-y-auto p-4 data-[side=right]:sm:max-w-4xl md:p-6"
      >
        <SheetTitle className="sr-only">{data ? `Company: ${data.company.name}` : "Company"}</SheetTitle>
        <SheetDescription className="sr-only">Company details, people and locations.</SheetDescription>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : data ? (
          <CompanyProfile
            data={data}
            permissions={permissions}
            currentUserId={currentUserId}
            variant="drawer"
            onClose={onClose}
          />
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true">
            <span className="sr-only">Loading company</span>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-2/3" />
            <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
