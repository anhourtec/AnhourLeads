import { type NextRequest, NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic routing before a request completes. Real authorization happens in route() and the
 * page context (src/server/auth/*); this only redirects signed-out visitors.
 */
function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

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
