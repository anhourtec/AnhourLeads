import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { ZodError } from "zod";

import type { Permission } from "@/lib/rbac/permissions";
import { type Actor, requirePermission, resolveActor } from "@/server/auth/actor";
import { log } from "@/server/log";
import { requestHost } from "@/server/tenancy/host";

import { forbidden, HttpError, tooManyRequests } from "./errors";
import { hitLimit, LIMITS, type Limit } from "./rate-limit";
import { randomUUID } from "node:crypto";

type Params = Record<string, string | string[]>;

export interface RouteArgs<P extends Params> {
  req: NextRequest;
  actor: Actor;
  params: P;
  requestId: string;
}

interface RouteOptions {
  /** Permission the actor's role must hold. Services may check more (e.g. ownership). */
  permission?: Permission;
  /** Rate limit. Defaults to LIMITS.read for GET and LIMITS.write otherwise. */
  limit?: Limit;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function errorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, ...(error.details ? { details: error.details } : {}) },
      { status: error.status, headers: { "x-request-id": requestId } },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Some fields are invalid.",
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 422, headers: { "x-request-id": requestId } },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "The request body isn't valid JSON." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  log.error("unhandled api error", { component: "api", requestId, error });
  return NextResponse.json(
    { error: "Something went wrong. Quote this request id to support.", requestId },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}

/**
 * Wrap every authenticated API handler: resolves the actor (API key or session), checks the
 * permission, enforces same-origin for cookie-authenticated writes (CSRF), applies the rate limit,
 * maps errors to JSON and writes one access log line. Handlers return a Response or plain data.
 */
export function route<P extends Params = Params>(
  handler: (args: RouteArgs<P>) => Promise<unknown>,
  options: RouteOptions = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    let actor: Actor | null = null;
    let status = 500;
    try {
      actor = await resolveActor(req.headers);

      if (actor.kind === "user" && !SAFE_METHODS.has(req.method)) {
        const origin = req.headers.get("origin");
        if (!origin || new URL(origin).host.toLowerCase() !== requestHost(req.headers)) {
          throw forbidden("Cross-site request refused.");
        }
      }

      if (options.permission) requirePermission(actor, options.permission);

      const limit = options.limit ?? (SAFE_METHODS.has(req.method) ? LIMITS.read : LIMITS.write);
      const who = actor.apiKeyId ?? actor.userId ?? "anon";
      const { allowed } = await hitLimit(`${who}:${req.method}:${req.nextUrl.pathname}`, limit);
      if (!allowed) throw tooManyRequests();

      const result = await handler({ req, actor, params: await ctx.params, requestId });
      const response = result instanceof Response ? result : NextResponse.json(result ?? { ok: true }, { status: 200 });
      response.headers.set("x-request-id", requestId);
      status = response.status;
      return response;
    } catch (error) {
      const response = errorResponse(error, requestId);
      status = response.status;
      return response;
    } finally {
      log.info("request", {
        component: "api",
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        status,
        durationMs: Date.now() - started,
        userId: actor?.userId,
        apiKeyId: actor?.apiKeyId,
        organizationId: actor?.organizationId,
      });
    }
  };
}

/** Parse a JSON body (empty body → {}). */
export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}

export interface Page {
  page: number;
  perPage: number;
  offset: number;
}

/** Apollo-style pagination: `page` (1-based) and `per_page` (max 100). */
export function pageFrom(input: { page?: unknown; per_page?: unknown; perPage?: unknown }): Page {
  const page = Math.max(1, Number.parseInt(String(input.page ?? 1), 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(String(input.per_page ?? input.perPage ?? 25), 10) || 25));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function pagination(page: Page, total: number) {
  return {
    page: page.page,
    per_page: page.perPage,
    total_entries: total,
    total_pages: Math.max(1, Math.ceil(total / page.perPage)),
  };
}
