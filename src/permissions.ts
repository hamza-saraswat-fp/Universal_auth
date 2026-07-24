import { AuthError, ROLE_RANK, type FpClaims, type FpRole } from "./types";

/**
 * Every app grant carried by the token, as app slug to role.
 *
 * Returns `{}` for a user with no grants — being signed in says nothing about
 * what you're allowed to use.
 */
export function getApps(claims: FpClaims): Record<string, FpRole> {
  return claims.app_metadata?.apps ?? {};
}

/** True when `held` is at least as privileged as `required`. `admin` covers `member`. */
function satisfies(held: FpRole, required: FpRole): boolean {
  return ROLE_RANK.indexOf(held) >= ROLE_RANK.indexOf(required);
}

/**
 * Whether the user may use `app`, optionally at `role` or above.
 *
 * The non-throwing form of {@link requireApp} — for rendering decisions and
 * branching. Anything that gates access should use `requireApp`.
 */
export function hasApp(claims: FpClaims, app: string, role?: FpRole): boolean {
  const held = getApps(claims)[app];
  if (!held) return false;
  return role ? satisfies(held, role) : true;
}

/**
 * Assert the user may use `app`, optionally at `role` or above, and return the
 * role they actually hold so callers can branch without a second lookup.
 *
 * An `admin` satisfies a `member` requirement; the reverse does not.
 *
 * @throws {AuthError} 403 `forbidden` when the user has no grant for the app,
 * or holds a role below the one required.
 */
export function requireApp(claims: FpClaims, app: string, role?: FpRole): FpRole {
  const held = getApps(claims)[app];

  if (!held) {
    throw new AuthError(`No access to ${app}`, 403, "forbidden");
  }

  if (role && !satisfies(held, role)) {
    throw new AuthError(
      `Insufficient role for ${app}: has '${held}', needs '${role}'`,
      403,
      "forbidden",
    );
  }

  return held;
}
