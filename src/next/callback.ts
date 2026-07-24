/**
 * `@fieldpulse/auth/next/callback` — the PKCE code-exchange route.
 *
 * Server-side Google OAuth uses PKCE, so every app must host a route that
 * exchanges the returned `?code=` for a session. Without it, sign-in bounces
 * back to the app and silently does nothing.
 *
 * Consuming apps re-export it as a route handler:
 *
 *   // app/auth/callback/route.ts
 *   export { GET } from "@fieldpulse/auth/next/callback";
 *
 * TODO(IAI-408): implement GET — exchangeCodeForSession(code), honoring
 * `x-forwarded-host` so redirects are correct behind a load balancer.
 */

export {};
