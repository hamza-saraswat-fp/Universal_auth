"use client";

/**
 * `@fieldpulse/auth/react` — client-side provider, hooks, and guards.
 *
 * Everything here decides what to RENDER, never what to ALLOW. Claims on the
 * client are decoded, not verified, and client state can be fabricated. In
 * Next.js apps, enforcement is the proxy plus `requireAppServer()`; in SPAs,
 * these guards gate the app shell and the data layer is its own concern.
 */

export {
  FpAuthProvider,
  getBrowserSupabase,
  signInWithGoogle,
  signOut,
  useAppRole,
  useAuth,
  useUser,
} from "./react/auth-context";
export type {
  FpAuthProviderProps,
  SignInOptions,
  SignOutOptions,
} from "./react/auth-context";

export { RequireApp, RequireAuth } from "./react/guards";
export type { RequireAppProps, RequireAuthProps } from "./react/guards";

export type { AuthSnapshot, AuthStatus, FpUser } from "./react/state";
export { configureAuth } from "./env";
export type { AuthConfig } from "./env";
export type { FpClaims, FpRole } from "./types";
