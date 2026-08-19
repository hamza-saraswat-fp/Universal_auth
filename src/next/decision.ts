import { hasApp } from "../permissions";
import type { FpClaims, FpRole } from "../types";

/** Configuration for {@link createAuthProxy}. All fields optional. */
export interface AuthProxyConfig {
  /**
   * This deployment's app slug in `app_permissions`. When set, the proxy
   * requires a grant for this app on every non-public path; signed-in users
   * without one are redirected to {@link noAccessPath}.
   *
   * When omitted, the proxy only requires a valid session, and every page
   * enforces its own access with `requireAppServer()` -- easy to forget, so
   * prefer setting the slug.
   */
  app?: string;
  /** Minimum role for {@link app}. `admin` satisfies a `"member"` requirement. */
  role?: FpRole;
  /** Where the signed-out land. Default `/login`. Always public. */
  loginPath?: string;
  /**
   * Where the signed-in-but-not-permitted land. Default `/no-access`. Always
   * public. The app renders a real page here -- who to ask for access -- so
   * being unpermitted looks intentional rather than broken.
   */
  noAccessPath?: string;
  /**
   * Extra path prefixes that skip auth entirely, matched on segment
   * boundaries. `/auth` (the callback and error routes), `loginPath`, and
   * `noAccessPath` are always public.
   */
  publicPaths?: string[];
}

export interface ResolvedProxyConfig {
  app?: string;
  role?: FpRole;
  loginPath: string;
  noAccessPath: string;
  publicPrefixes: string[];
}

export function resolveConfig(config: AuthProxyConfig = {}): ResolvedProxyConfig {
  const loginPath = config.loginPath ?? "/login";
  const noAccessPath = config.noAccessPath ?? "/no-access";
  return {
    app: config.app,
    role: config.role,
    loginPath,
    noAccessPath,
    publicPrefixes: ["/auth", loginPath, noAccessPath, ...(config.publicPaths ?? [])],
  };
}

/** Prefix match on segment boundaries: `/auth` covers `/auth/callback`, not `/authx`. */
function isPublic(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type ProxyDecision = { action: "pass" } | { action: "redirect"; to: string };

/**
 * The proxy's routing decision, as a pure function so the full matrix is
 * testable without a running server:
 *
 *   signed out, protected path   -> redirect loginPath
 *   signed in, no grant for app  -> redirect noAccessPath
 *   public path                  -> pass, always
 *   otherwise                    -> pass
 */
export function resolveProxyDecision(
  claims: FpClaims | null,
  pathname: string,
  config: ResolvedProxyConfig,
): ProxyDecision {
  if (isPublic(pathname, config.publicPrefixes)) return { action: "pass" };

  if (!claims) return { action: "redirect", to: config.loginPath };

  if (config.app && !hasApp(claims, config.app, config.role)) {
    return { action: "redirect", to: config.noAccessPath };
  }

  return { action: "pass" };
}
