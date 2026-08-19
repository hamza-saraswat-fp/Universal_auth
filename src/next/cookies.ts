import { NextResponse, type NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";

/**
 * The request/response cookie contract from Supabase's canonical proxy
 * example, factored out so it can be tested directly.
 *
 * When @supabase/ssr refreshes a session it calls `setAll` with the new
 * cookies AND a set of anti-caching headers (`Cache-Control: private,
 * no-cache, ...`). Both must reach the response: dropping the cookies logs
 * the user out on the next request; dropping the headers lets a CDN cache
 * one user's session and serve it to another.
 */
export function bridgeCookies(request: NextRequest) {
  let response = NextResponse.next({ request });
  let appliedHeaders: Record<string, string> = {};

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet, headers) {
      // Mutate the request first, then rebuild the response FROM that mutated
      // request -- this is how the refreshed token reaches Server Components
      // on this same request instead of them re-refreshing it.
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
      Object.entries(headers ?? {}).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      appliedHeaders = { ...appliedHeaders, ...(headers ?? {}) };
    },
  };

  return {
    cookieMethods,
    /** The response to return. Reassigned whenever cookies are written. */
    get response() {
      return response;
    },
    /**
     * Carry auth cookies and anti-caching headers onto a different response
     * (e.g. a redirect). Returning a response without the refreshed cookies
     * desyncs browser and server and terminates the session prematurely.
     */
    applyTo(other: NextResponse): NextResponse {
      response.cookies.getAll().forEach((cookie) => other.cookies.set(cookie));
      Object.entries(appliedHeaders).forEach(([key, value]) =>
        other.headers.set(key, value),
      );
      return other;
    },
  };
}
