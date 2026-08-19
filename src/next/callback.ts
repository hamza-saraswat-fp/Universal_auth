/**
 * `@fieldpulse/auth/next/callback` — the PKCE code-exchange route.
 *
 * Server-side Google OAuth returns to the app with a `?code=` that must be
 * exchanged for a session. Every app hosts this route; without it, sign-in
 * silently does nothing.
 *
 * ```ts
 * // app/auth/callback/route.ts
 * export { GET } from "@fieldpulse/auth/next/callback";
 * ```
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "./server-client";

/**
 * Clamp the `?next=` redirect target to a same-origin path.
 *
 * `startsWith("/")` alone is not enough: browsers treat `//evil.com` and
 * `/\evil.com` as protocol-relative URLs, which would turn the callback into
 * an open redirect.
 */
export function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export interface CallbackOptions {
  /** Where to land when the exchange fails. Default `/auth/error`. */
  errorPath?: string;
}

/** Build the callback handler with custom options; most apps re-export {@link GET}. */
export function createCallbackRoute(options: CallbackOptions = {}) {
  const errorPath = options.errorPath ?? "/auth/error";

  return async function GET(request: Request): Promise<NextResponse> {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = sanitizeNext(searchParams.get("next"));

    if (code) {
      const supabase = await createServerSupabase();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        // Behind Vercel's load balancer, `origin` is the internal host;
        // x-forwarded-host is the address the user actually visited. In dev
        // there is no load balancer, so origin is already right.
        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalDev = process.env.NODE_ENV === "development";
        const base = !isLocalDev && forwardedHost ? `https://${forwardedHost}` : origin;

        const response = NextResponse.redirect(`${base}${next}`);
        // This response sets the session cookies -- it must never be cached,
        // or a CDN can serve one user's session to another.
        response.headers.set(
          "Cache-Control",
          "private, no-cache, no-store, must-revalidate, max-age=0",
        );
        response.headers.set("Expires", "0");
        response.headers.set("Pragma", "no-cache");
        return response;
      }

      console.warn(`[fieldpulse-auth] code exchange failed: ${error.message}`);
    }

    return NextResponse.redirect(`${origin}${errorPath}`);
  };
}

/** The zero-config handler: `export { GET } from "@fieldpulse/auth/next/callback"`. */
export const GET = createCallbackRoute();
