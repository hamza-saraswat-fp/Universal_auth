import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authUrl, publishableKey } from "../env";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Create one per request, always — never a module-level singleton. The client
 * carries request-scoped cookie state; sharing it across requests leaks one
 * user's session into another's.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(authUrl(), publishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, which cannot write cookies. Safe to
          // ignore as long as the auth proxy is installed -- it refreshes the
          // session and writes cookies on every request.
        }
      },
    },
  });
}
