import "server-only";

import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/server/db";
import { sendMail } from "@/server/email/mailer";
import { env } from "@/server/env";
import type { Tenant } from "@/server/tenancy/host";

import { ac, orgRoles } from "./access";

async function firstMembership(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt))
    .limit(1);
  return row?.organizationId ?? null;
}

async function isMember(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

function createAuth(tenant: Tenant) {
  const origin = `${env().APP_PROTOCOL}://${tenant.host}`;
  const workspaceId = tenant.kind === "workspace" ? tenant.organizationId : null;

  return betterAuth({
    baseURL: origin,
    secret: env().BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // After sign-up the client calls POST /api/v1/workspaces/register to create the user's workspace.
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Reset your password",
          text: `Use this link to choose a new password: ${url}\n\nIf you didn't ask for this, ignore this email.`,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: process.env.NODE_ENV === "production", window: 60, max: 30 },
    advanced: {
      cookiePrefix: "anhour",
      ipAddress: { ipAddressHeaders: env().APP_TRUST_PROXY ? ["x-forwarded-for"] : [] },
    },
    hooks: {
      // On a workspace's own hostname, only that workspace's members may sign in.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !env().APP_ALLOW_SIGNUP) {
          throw new APIError("FORBIDDEN", {
            message: "Sign-up is turned off. Ask a workspace administrator for an invite.",
          });
        }
        if (!workspaceId) return;
        if (ctx.path === "/sign-up/email") {
          throw new APIError("FORBIDDEN", { message: "Sign-up isn't available on this address." });
        }
        if (ctx.path !== "/sign-in/email") return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase();
        const [found] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, email))
          .limit(1);
        if (!found || !(await isMember(found.id, workspaceId))) {
          throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Every session starts in a workspace: the host's workspace, else the user's first one.
          before: async (session) => {
            const activeOrganizationId = workspaceId ?? (await firstMembership(session.userId));
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles: orgRoles,
        creatorRole: "owner",
        // Workspaces are created by POST /api/v1/workspaces/register or by platform administrators.
        allowUserToCreateOrganization: async (user) => user.role === "admin",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
          const brand = (org as { brandName?: string | null }).brandName ?? org.name;
          await sendMail({
            to: email,
            fromName: brand,
            subject: `${inviter.user.name} invited you to ${brand}`,
            text: `${inviter.user.name} invited you to join ${brand}.\n\nAccept the invitation: ${origin}/auth/accept-invite/${id}\n\nThe link expires in 7 days.`,
          });
        },
      }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { anhourAuth?: Map<string, Auth> };

/** Better Auth instance for a resolved tenant. One per hostname, cached for the process. */
export function getAuth(tenant: Tenant): Auth {
  globalForAuth.anhourAuth ??= new Map();
  const key = `${tenant.kind === "workspace" ? tenant.organizationId : "primary"}|${tenant.host}`;
  let instance = globalForAuth.anhourAuth.get(key);
  if (!instance) {
    instance = createAuth(tenant);
    globalForAuth.anhourAuth.set(key, instance);
  }
  return instance;
}

/** Drop cached instances for a hostname (called when a domain is removed or stops serving). */
export function dropAuth(host: string): void {
  for (const key of globalForAuth.anhourAuth?.keys() ?? []) {
    if (key.endsWith(`|${host}`)) globalForAuth.anhourAuth?.delete(key);
  }
}
