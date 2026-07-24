import { AuthError } from "./types";

function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * Base URL of the central auth project, e.g. `https://<ref>.supabase.co`.
 *
 * A service that only verifies tokens needs this and nothing else: JWKS is
 * public, so verification never requires an API key.
 */
export function authUrl(): string {
  const url = read("FP_AUTH_URL", "NEXT_PUBLIC_FP_AUTH_URL");
  if (!url) {
    throw new AuthError("FP_AUTH_URL (or NEXT_PUBLIC_FP_AUTH_URL) is not set", 500, "config");
  }
  return url.replace(/\/+$/, "");
}

/**
 * Publishable key (`sb_publishable_…`) for the central auth project. Browser-safe
 * by design, and only needed by apps that run a sign-in flow.
 */
export function publishableKey(): string {
  const key = read("FP_AUTH_PUBLISHABLE_KEY", "NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY");
  if (!key) {
    throw new AuthError(
      "FP_AUTH_PUBLISHABLE_KEY (or NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY) is not set",
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
