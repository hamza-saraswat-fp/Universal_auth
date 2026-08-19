"use client";

/**
 * `@fieldpulse/auth/react` — client-side provider and hooks.
 *
 * Everything here exists to decide what to RENDER, never what to ALLOW.
 * Claims on the client are decoded, not verified, and a determined user can
 * fabricate anything a client reads. The proxy and `requireAppServer()` do
 * the verifying, server-side, on every request. If removing a client check
 * would let someone do something they shouldn't, that check belongs on the
 * server instead.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { authUrl, publishableKey } from "./env";
import { getApps } from "./permissions";
import { AuthError, type FpClaims, type FpRole } from "./types";
import {
  buildSignInRedirect,
  LOADING,
  snapshotFromToken,
  type AuthSnapshot,
  type FpUser,
  type SignInRedirectOptions,
} from "./react/state";

export type { AuthSnapshot, AuthStatus, FpUser } from "./react/state";

let browserClient: SupabaseClient | undefined;

/**
 * The Supabase browser client for the auth project, created on first use.
 * Module-level on purpose: unlike the server client, the browser client is
 * one-per-tab by design.
 */
export function getBrowserSupabase(): SupabaseClient {
  browserClient ??= createBrowserClient(authUrl(), publishableKey());
  return browserClient;
}

const AuthContext = createContext<AuthSnapshot | null>(null);

export interface FpAuthProviderProps {
  children: ReactNode;
  /** Override the Supabase client — for tests. Apps never pass this. */
  client?: SupabaseClient;
}

/**
 * Wraps the app (usually in the root layout) and owns the auth state that
 * {@link useAuth}, {@link useUser}, and {@link useAppRole} read.
 *
 * ```tsx
 * <FpAuthProvider>{children}</FpAuthProvider>
 * ```
 */
export function FpAuthProvider({ children, client }: FpAuthProviderProps) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(LOADING);

  useEffect(() => {
    const supabase = client ?? getBrowserSupabase();
    let active = true;

    // Seed from the stored session, then track changes. Both paths write the
    // same snapshot, so whichever runs first is fine.
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSnapshot(snapshotFromToken(data.session?.access_token));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous — awaiting supabase.auth.* calls inside
      // onAuthStateChange is a documented deadlock.
      setSnapshot(snapshotFromToken(session?.access_token));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  return createElement(AuthContext.Provider, { value: snapshot }, children);
}

/**
 * Full auth state: `{ status, user, claims }`, where `status` distinguishes
 * `"loading"` from `"signed-out"`. Use this wherever a signed-out flash would
 * be visible — render a skeleton while `status === "loading"`.
 */
export function useAuth(): AuthSnapshot {
  const snapshot = useContext(AuthContext);
  if (!snapshot) {
    throw new Error("useAuth/useUser/useAppRole need <FpAuthProvider> above them in the tree");
  }
  return snapshot;
}

/**
 * The signed-in person, or `null` while loading OR signed out. When that
 * ambiguity matters, use {@link useAuth} and branch on `status`.
 */
export function useUser(): FpUser | null {
  return useAuth().user;
}

/**
 * The role this user holds on `app`, or `null`.
 *
 * A RENDERING hint — show or hide the admin tab. It is not an authorization
 * decision: client state can be fabricated, so anything that matters is
 * enforced server-side with `requireAppServer()` or `verifyToken()`.
 */
export function useAppRole(app: string): FpRole | null {
  const { claims } = useAuth();
  return claims ? (getApps(claims)[app] ?? null) : null;
}

export interface SignInOptions extends SignInRedirectOptions {
  /** Override the Supabase client — for tests. */
  client?: SupabaseClient;
}

/**
 * Start Google sign-in. Sends the user to Google, then back to the app's
 * `/auth/callback` route, then on to the page they started from (or `next`).
 *
 * The `hd` hint pre-filters Google's account picker to fieldpulse.com — a
 * courtesy, not a control; the Internal consent screen and the database hook
 * do the enforcing.
 */
export async function signInWithGoogle(options: SignInOptions = {}): Promise<void> {
  const supabase = options.client ?? getBrowserSupabase();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: buildSignInRedirect(window.location, options),
      queryParams: { hd: "fieldpulse.com", prompt: "select_account" },
    },
  });

  if (error) {
    throw new AuthError(`Could not start sign-in: ${error.message}`, 503, "unavailable", {
      cause: error,
    });
  }
}

export interface SignOutOptions {
  /** Where to land after signing out. Default `/login`. */
  redirectTo?: string;
  /** Override the Supabase client — for tests. */
  client?: SupabaseClient;
}

/**
 * Sign out and hard-navigate away. The full navigation is deliberate: it runs
 * the proxy again so the server sees the cleared session immediately, instead
 * of a client-side route change rendering stale state.
 */
export async function signOut(options: SignOutOptions = {}): Promise<void> {
  const supabase = options.client ?? getBrowserSupabase();
  await supabase.auth.signOut();
  window.location.assign(options.redirectTo ?? "/login");
}

export type { FpClaims, FpRole };
