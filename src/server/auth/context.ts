import "server-only";

import { cache } from "react";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { asc, eq } from "drizzle-orm";

import { type Brand, DEFAULT_BRAND } from "@/config/brand";
import { isRole, type Role } from "@/lib/rbac/permissions";
import { db, schema } from "@/server/db";
import { workspaceBrand } from "@/server/tenancy/brand";
import { requestHost, resolveTenant, type Tenant } from "@/server/tenancy/host";

import { getAuth } from "./auth";

export interface Membership {
  organizationId: string;
  name: string;
  slug: string;
  role: Role;
}

export interface AppContext {
  tenant: Tenant;
  brand: Brand;
  user: { id: string; name: string; email: string; image: string | null; isPlatformAdmin: boolean };
  workspace: Membership | null;
  memberships: Membership[];
}

/** Tenant and brand for a page, signed in or not. Unknown hostnames render the not-found page. */
export const getTenantBrand = cache(async (): Promise<{ tenant: Tenant; brand: Brand }> => {
  const tenant = await resolveTenant(requestHost(await headers()));
  if (!tenant) notFound();
  const brand = tenant.kind === "workspace" ? await workspaceBrand(tenant.organizationId) : DEFAULT_BRAND;
  return { tenant, brand };
});

/** Signed-in context for app pages. Redirects to sign-in when there's no session. */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const { tenant, brand: hostBrand } = await getTenantBrand();
  const requestHeaders = await headers();
  const session = await getAuth(tenant).api.getSession({ headers: requestHeaders });
  if (!session) redirect("/auth/login");

  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      name: schema.organization.name,
      slug: schema.organization.slug,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, session.user.id))
    .orderBy(asc(schema.member.createdAt));

  const memberships: Membership[] = rows.flatMap((r) => (isRole(r.role) ? [{ ...r, role: r.role }] : []));
  const activeId =
    tenant.kind === "workspace"
      ? tenant.organizationId
      : (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
  const workspace = memberships.find((m) => m.organizationId === activeId) ?? null;
  // On the installation's own hosts a signed-in user sees their workspace's brand.
  const brand = tenant.kind === "primary" && workspace ? await workspaceBrand(workspace.organizationId) : hostBrand;

  return {
    tenant,
    brand,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
      isPlatformAdmin: (session.user as { role?: string | null }).role === "admin",
    },
    workspace,
    memberships: tenant.kind === "workspace" ? memberships.filter((m) => m.organizationId === activeId) : memberships,
  };
});

/**
 * Brand for the current request without redirects: the white-label host's brand, else the
 * signed-in user's active workspace brand, else the installation default. Used by the root layout.
 */
export const getRequestBrand = cache(async (): Promise<Brand> => {
  const requestHeaders = await headers();
  const tenant = await resolveTenant(requestHost(requestHeaders));
  if (!tenant) return DEFAULT_BRAND;
  if (tenant.kind === "workspace") return workspaceBrand(tenant.organizationId);
  const session = await getAuth(tenant).api.getSession({ headers: requestHeaders });
  const activeId = (session?.session as { activeOrganizationId?: string | null } | undefined)?.activeOrganizationId;
  return activeId ? workspaceBrand(activeId) : DEFAULT_BRAND;
});
