import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionUser } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "@/server/http/errors";
import { hitLimit, LIMITS } from "@/server/http/rate-limit";
import { errorResponse, readJson } from "@/server/http/route";
import { requestHost } from "@/server/tenancy/host";

import { randomUUID } from "node:crypto";

const body = z.object({ workspaceName: z.string().trim().min(2).max(80) });

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${randomUUID().slice(0, 6)}`;
}

/**
 * Create the first workspace for a newly signed-up user, who becomes its owner. Only on the
 * installation's own hostnames, only when sign-up is enabled, and only for users with no workspace.
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  try {
    if (!env().APP_ALLOW_SIGNUP) throw forbidden("Sign-up is turned off.");
    const session = await getSessionUser(req.headers);
    if (!session) throw unauthorized();
    if (session.tenant.kind !== "primary") throw forbidden("Sign-up isn't available on this address.");
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host.toLowerCase() !== requestHost(req.headers)) {
      throw forbidden("Cross-site request refused.");
    }
    const { allowed } = await hitLimit(`register:${session.user.id}`, LIMITS.sensitive);
    if (!allowed) throw tooManyRequests();

    const { workspaceName } = body.parse(await readJson(req));
    const existing = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, session.user.id))
      .limit(1);
    if (existing.length) throw conflict("You already belong to a workspace.");
    if (!workspaceName) throw badRequest("Name your workspace.");

    const organizationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.organization)
        .values({ id: organizationId, name: workspaceName, slug: slugify(workspaceName) });
      await tx
        .insert(schema.member)
        .values({ id: randomUUID(), organizationId, userId: session.user.id, role: "owner" });
      await tx
        .update(schema.session)
        .set({ activeOrganizationId: organizationId })
        .where(eq(schema.session.id, session.session.id));
      await tx.insert(schema.auditLog).values({
        organizationId,
        actorUserId: session.user.id,
        action: "workspace.create",
        entityType: "workspace",
        entityId: organizationId,
      });
    });
    return NextResponse.json({ workspace: { id: organizationId, name: workspaceName } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
