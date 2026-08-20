/**
 * Provider, hooks, and sign-in/out actions. Everything here decides what to
 * RENDER, never what to ALLOW — client state can be fabricated. Enforcement
 * lives in the proxy and `requireAppServer()` (Next.js apps) or in whatever
 * backend verifies tokens (SPAs).
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
import { authUrl, publishableKey } from "../env";
import { getApps } from "../permissions";
import { AuthError, type FpRole } from "../types";
import {
  buildSignInRedirect,
  LOADING,
  snapshotFromToken,
  type AuthSnapshot,
  type FpUser,
  type SignInRedirectOptions,
} from "./state";

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

interface AuthContextValue {
  snapshot: AuthSnapshot;
  client: SupabaseClient;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface FpAuthProviderProps {
  children: ReactNode;
  /** Override the Supabase client — for tests. Apps never pass this. */
  client?: SupabaseClient;
}

/**
 * Wraps the app (root layout / app entry) and owns the auth state that
 * {@link useAuth}, {@link useUser}, and {@link useAppRole} read.
 */
export function FpAuthProvider({ children, client }: FpAuthProviderProps) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(LOADING);
  // Resolved once per provider instance; stable across renders.
  const [resolvedClient] = useState(() => client ?? getBrowserSupabase());

  useEffect(() => {
    let active = true;

    // Seed from the stored session, then track changes. Both paths write the
    // same snapshot, so whichever runs first is fine.
    void resolvedClient.auth.getSession().then(({ data }) => {
      if (active) setSnapshot(snapshotFromToken(data.session?.access_token));
    });

    const {
      data: { subscription },
    } = resolvedClient.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous — awaiting supabase.auth.* calls inside
      // onAuthStateChange is a documented deadlock.
      setSnapshot(snapshotFromToken(session?.access_token));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [resolvedClient]);

  return createElement(AuthContext.Provider, { value: { snapshot, client: resolvedClient } }, children);
}

function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error(
      "useAuth/useUser/useAppRole and the auth guards need <FpAuthProvider> above them in the tree",
    );
  }
  return value;
}

/**
 * Full auth state: `{ status, user, claims }`, where `status` distinguishes
 * `"loading"` from `"signed-out"`. Use this wherever a signed-out flash would
 * be visible — render a skeleton while `status === "loading"`.
 */
export function useAuth(): AuthSnapshot {
  return useAuthContext().snapshot;
}

/** The provider's Supabase client. Internal — used by the guards' actions. */
export function useAuthClient(): SupabaseClient {
  return useAuthContext().client;
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
 * enforced server-side.
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
 * Start Google sign-in. Next.js apps get the callback-route flow by default;
 * SPAs pass `redirectTo: window.location.href` (the guards do this for you) —
 * the browser client exchanges the returning `?code=` automatically and
 * cleans the URL, no server involved.
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
  /**
   * Where to land after signing out. Default `/login` (Next.js apps). SPAs
   * using the guards get their current URL, which re-renders the sign-in
   * screen.
   */
  redirectTo?: string;
  /** Override the Supabase client — for tests. */
  client?: SupabaseClient;
}

/**
 * Sign out and hard-navigate away. The full navigation is deliberate: it runs
 * the proxy (or re-mounts the SPA) so nothing keeps rendering stale state.
 */
export async function signOut(options: SignOutOptions = {}): Promise<void> {
  const supabase = options.client ?? getBrowserSupabase();
  await supabase.auth.signOut();
  window.location.assign(options.redirectTo ?? "/login");
}
