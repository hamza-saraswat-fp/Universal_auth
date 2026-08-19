import { decodeJwt } from "jose";
import type { FpClaims } from "../types";

/**
 * Pure state helpers for the React entry. No React imports, so the logic is
 * testable without a DOM.
 */

/** Display identity for the signed-in person. */
export interface FpUser {
  id: string;
  email?: string;
  /** Display name from Google, when present. */
  name?: string;
  avatarUrl?: string;
}

/**
 * `loading` is distinct from `signed-out` on purpose: a hook that returns null
 * while resolving is indistinguishable from "not signed in" and causes UI
 * flicker or a false access-denied flash on every hard refresh.
 */
export type AuthStatus = "loading" | "signed-in" | "signed-out";

export interface AuthSnapshot {
  status: AuthStatus;
  claims: FpClaims | null;
  user: FpUser | null;
}

export const LOADING: AuthSnapshot = { status: "loading", claims: null, user: null };
export const SIGNED_OUT: AuthSnapshot = { status: "signed-out", claims: null, user: null };

/**
 * Build the snapshot from an access token.
 *
 * The token is DECODED here, not verified — this state exists to decide what
 * to render, never what to allow. Verification happens where it matters: the
 * proxy and the server guards check the signature on every request.
 */
export function snapshotFromToken(accessToken: string | null | undefined): AuthSnapshot {
  if (!accessToken) return SIGNED_OUT;
  try {
    const claims = decodeJwt(accessToken) as unknown as FpClaims;
    return { status: "signed-in", claims, user: toFpUser(claims) };
  } catch {
    // A token that doesn't even parse renders as signed out; the server side
    // will reject it properly on the next request.
    return SIGNED_OUT;
  }
}

/** Display identity from the token. `user_metadata` is fine here — rendering only. */
export function toFpUser(claims: FpClaims): FpUser {
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  return {
    id: claims.sub,
    email: claims.email,
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
}

export interface SignInRedirectOptions {
  /** Full override of the OAuth return URL. Must be on the redirect allow-list. */
  redirectTo?: string;
  /** Same-origin path to land on after sign-in. Defaults to the current page. */
  next?: string;
}

/**
 * Where Google should send the user back to: the app's callback route, with a
 * `next` param so they land on the page they were trying to reach.
 */
export function buildSignInRedirect(
  location: { origin: string; pathname: string; search: string },
  options: SignInRedirectOptions = {},
): string {
  if (options.redirectTo) return options.redirectTo;

  const next = options.next ?? `${location.pathname}${location.search}`;
  const base = `${location.origin}/auth/callback`;
  return next && next !== "/" ? `${base}?next=${encodeURIComponent(next)}` : base;
}
