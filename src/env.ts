import { AuthError } from "./types";

/**
 * Configuration resolution, in priority order:
 *
 *   1. Explicit config via {@link configureAuth} — the only option in builds
 *      with no `process.env`, like Vite/CRA SPAs.
 *   2. `FP_AUTH_URL` / `FP_AUTH_PUBLISHABLE_KEY` — server-side env.
 *   3. `NEXT_PUBLIC_`-prefixed variants — Next.js browser bundles.
 */

export interface AuthConfig {
  /** Base URL of the central auth project, e.g. `https://<ref>.supabase.co`. */
  url?: string;
  /** Publishable key (`sb_publishable_…`). Browser-safe by design. */
  publishableKey?: string;
}

let explicit: AuthConfig = {};

/**
 * Set the auth project's URL and publishable key explicitly.
 *
 * Required in bundlers that don't provide `process.env` (Vite, CRA). Call it
 * once at app startup, from YOUR source — that's where Vite's static env
 * replacement works:
 *
 * ```ts
 * configureAuth({
 *   url: import.meta.env.VITE_FP_AUTH_URL,
 *   publishableKey: import.meta.env.VITE_FP_AUTH_PUBLISHABLE_KEY,
 * });
 * ```
 *
 * Passing `undefined` for a field clears it back to env-var resolution.
 */
export function configureAuth(config: AuthConfig): void {
  explicit = { ...explicit, ...config };
}

/** `process.env` doesn't exist in Vite/CRA browser builds — never assume it. */
function envVar(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value || undefined;
}

/**
 * Base URL of the central auth project.
 *
 * A service that only verifies tokens needs this and nothing else: JWKS is
 * public, so verification never requires an API key.
 */
export function authUrl(): string {
  const url = explicit.url ?? envVar("FP_AUTH_URL") ?? envVar("NEXT_PUBLIC_FP_AUTH_URL");
  if (!url) {
    throw new AuthError(
      "Auth project URL is not set. Set FP_AUTH_URL (or NEXT_PUBLIC_FP_AUTH_URL), or call configureAuth({ url }) at startup — required under Vite/CRA where process.env does not exist.",
      500,
      "config",
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Publishable key (`sb_publishable_…`) for the central auth project. Browser-safe
 * by design, and only needed by apps that run a sign-in flow.
 */
export function publishableKey(): string {
  const key =
    explicit.publishableKey ??
    envVar("FP_AUTH_PUBLISHABLE_KEY") ??
    envVar("NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY");
  if (!key) {
    throw new AuthError(
      "Publishable key is not set. Set FP_AUTH_PUBLISHABLE_KEY (or NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY), or call configureAuth({ publishableKey }) at startup.",
      500,
      "config",
    );
  }
  return key;
}

/** Expected `iss` claim on tokens from the central auth project. */
export function issuer(): string {
  return `${authUrl()}/auth/v1`;
}

/** Public key set every service verifies against. */
export function jwksUrl(): string {
  return `${authUrl()}/auth/v1/.well-known/jwks.json`;
}
