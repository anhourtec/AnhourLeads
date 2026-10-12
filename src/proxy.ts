import { type NextRequest, NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic routing before a request completes. Real authorization happens in route() and the
 * page context (src/server/auth/*); this only redirects signed-out visitors and hides the admin
 * template's demo screens, which are kept in the tree for reference but are not part of the product.
 */
const TEMPLATE_ROUTES = [
  "/auth/v1",
  "/auth/v2",
  "/chat",
  "/mail",
  "/dashboard/default",
  "/dashboard/crm",
  "/dashboard/finance",
  "/dashboard/ecommerce",
  "/dashboard/academy",
  "/dashboard/logistics",
  "/dashboard/infrastructure",
  "/dashboard/productivity",
  "/dashboard/patient-monitoring",
  "/dashboard/kanban",
  "/dashboard/calendar",
  "/dashboard/chat",
  "/dashboard/mail",
  "/dashboard/file-manager",
  "/dashboard/invoice",
  "/dashboard/coming-soon",
  "/dashboard/users",
  "/dashboard/roles",
  "/dashboard/profile",
  "/dashboard/default-v1",
  "/dashboard/crm-v1",
  "/dashboard/analytics-v1",
  "/dashboard/finance-v1",
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (TEMPLATE_ROUTES.some((prefix) => matches(pathname, prefix))) {
    return NextResponse.rewrite(new URL("/not-found-page", req.url), { status: 404 });
  }

  const hasSession = Boolean(getSessionCookie(req, { cookiePrefix: "anhour" }));

  if (pathname === "/") {
    return NextResponse.redirect(new URL(hasSession ? "/dashboard/home" : "/auth/login", req.url));
  }

  if ((matches(pathname, "/dashboard") || matches(pathname, "/onboarding")) && !hasSession) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|svg|jpg|ico|txt)$).*)"],
};
