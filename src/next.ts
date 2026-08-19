/**
 * `@fieldpulse/auth/next` — Next.js App Router integration.
 *
 * Three pieces: a proxy that refreshes the session and gates every request, a
 * PKCE callback route (exported from `@fieldpulse/auth/next/callback`), and
 * server-side guards for Server Components and Route Handlers.
 *
 * The proxy works under either filename — `proxy.ts` on Next 16, or
 * `middleware.ts` on Next 14/15. An app must define only ONE of the two files;
 * defining both behaves unpredictably.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl, publishableKey } from "./env";
import { requireApp } from "./permissions";
import { AuthError, type FpClaims, type FpRole } from "./types";
import { bridgeCookies } from "./next/cookies";
import { resolveConfig, resolveProxyDecision, type AuthProxyConfig } from "./next/decision";
import { createServerSupabase } from "./next/server-client";

export type { AuthProxyConfig } from "./next/decision";
export { createServerSupabase } from "./next/server-client";

/**
 * Build the auth proxy for a Next.js app.
 *
 * ```ts
 * // proxy.ts (Next 16) — or middleware.ts on Next 14/15, never both
 * import { createAuthProxy, authProxyMatcher } from "@fieldpulse/auth/next";
 *
 * export const proxy = createAuthProxy({ app: "comp-intel" });
 * export const config = { matcher: authProxyMatcher };
 * ```
 *
 * On every matched request it refreshes the session via `getClaims()` (which
 * verifies the JWT signature against the auth project's public keys and
 * refreshes expired tokens), then routes: signed out → `loginPath`; signed in
 * without a grant for `app` → `noAccessPath`; otherwise through.
 */
export function createAuthProxy(config: AuthProxyConfig = {}) {
  const resolved = resolveConfig(config);

  return async function authProxy(request: NextRequest): Promise<NextResponse> {
    const bridge = bridgeCookies(request);

    const supabase = createServerClient(authUrl(), publishableKey(), {
      cookies: bridge.cookieMethods,
    });

    // Do not run code between createServerClient and getClaims(). And do not
    // remove getClaims(): it is what refreshes the token and writes the new
    // cookies -- without it users are randomly logged out.
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      // Can't verify: treat as signed out, matching Supabase's canonical
      // proxy. This includes JWKS being unreachable -- new page loads bounce
      // to login during an auth-project outage, while already-rendered pages
      // keep working. Logged because a burst of these means the auth project
      // is down, not that users are misbehaving.
      console.warn(`[fieldpulse-auth] getClaims failed in proxy: ${error.message}`);
    }

    const claims = (data?.claims as unknown as FpClaims) ?? null;
    const decision = resolveProxyDecision(claims, request.nextUrl.pathname, resolved);

    if (decision.action === "redirect") {
      // A new response object must carry over the refreshed auth cookies and
      // anti-caching headers, or browser and server fall out of sync.
      return bridge.applyTo(NextResponse.redirect(new URL(decision.to, request.url)));
    }

    return bridge.response;
  };
}

/**
 * Matcher for the proxy: everything except Next internals and static assets.
 * Re-export it next to the proxy:
 *
 * ```ts
 * export const config = { matcher: authProxyMatcher };
 * ```
 */
export const authProxyMatcher = [
  "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
];

/**
 * The verified claims of the current request's session, or `null` when signed
 * out. For Server Components and Route Handlers.
 *
 * @throws {AuthError} when the session exists but cannot be verified.
 */
export async function getServerClaims(): Promise<FpClaims | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    throw new AuthError(`Could not verify session: ${error.message}`, 401, "invalid_token", {
      cause: error,
    });
  }

  return (data?.claims as unknown as FpClaims) ?? null;
}

/**
 * Assert the current user may use `app` (optionally at `role` or above) and
 * return the role they hold.
 *
 * The server-side guard for anything that matters — the proxy already gates
 * page loads, but data mutations and role-restricted surfaces check here so
 * authorization sits next to the thing it protects.
 *
 * ```ts
 * const role = await requireAppServer("comp-intel", "admin");
 * ```
 *
 * @throws {AuthError} 401 signed out; 403 no grant or insufficient role.
 */
export async function requireAppServer(app: string, role?: FpRole): Promise<FpRole> {
  const claims = await getServerClaims();
  if (!claims) {
    throw new AuthError("Not signed in", 401, "invalid_token");
  }
  return requireApp(claims, app, role);
}
