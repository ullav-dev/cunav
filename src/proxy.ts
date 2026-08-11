import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

function route(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // Next.js API routes — pass through without rewrite or intl locale prefix.
  if (
    pathname.startsWith("/api/ai/") ||
    pathname.startsWith("/api/notify/") ||
    pathname.startsWith("/api/email/") ||
    /^\/api\/tickets\/[^/]+\/send-email(\/status)?\/?$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Proxy /api/tack/* → tack-server (strips /api/tack prefix). Must come
  // before the general /api/* → awe-server rule below. Same "direct to
  // tack-server" pattern as tack's own app's /api/* rewrite -- a plain
  // passthrough of the caller's own tack JWT, not a translation layer.
  if (pathname.startsWith("/api/tack/")) {
    const tackUrl = process.env.TACK_URL ?? "http://localhost:8087";
    return NextResponse.rewrite(
      new URL(pathname.slice("/api/tack".length) + search, tackUrl)
    );
  }

  // All other /api/* paths forward to awe-server.
  if (pathname.startsWith("/api/")) {
    const apiUrl = process.env.API_URL ?? "http://localhost:8085";
    return NextResponse.rewrite(
      new URL(pathname.slice("/api".length) + search, apiUrl)
    );
  }

  if (pathname.startsWith("/auth-api/")) {
    const authUrl = process.env.AUTH_URL ?? "http://localhost:8081";
    return NextResponse.rewrite(
      new URL(pathname.slice("/auth-api".length) + search, authUrl)
    );
  }

  return intlMiddleware(request) as NextResponse;
}

export function proxy(request: NextRequest) {
  const response = route(request);
  const portalUrl =
    process.env.PORTAL_URL ?? "https://setanta-portal.ullav.com http://localhost:3003";
  response.headers.set("Content-Security-Policy", `frame-ancestors 'self' ${portalUrl}`);
  return response;
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
