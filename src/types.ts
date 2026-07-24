/** Roles a user can hold on an app, ordered from least to most privileged. */
export const ROLE_RANK = ["member", "admin"] as const;

export type FpRole = (typeof ROLE_RANK)[number];

/**
 * Claims carried by a `fieldpulse-auth` access token.
 *
 * Per-app roles live under `app_metadata`, which only the auth server can write.
 * `user_metadata` is user-editable and must never be used for authorization.
 */
export interface FpClaims {
  /** The user's id in the central auth project. */
  sub: string;
  email?: string;
  session_id?: string;
  exp: number;
  iat: number;
  iss: string;
  aud: string | string[];
  app_metadata?: {
    /** App slug to role, stamped in by the custom access token hook. */
    apps?: Record<string, FpRole>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Thrown when a token is invalid, or valid but not permitted for what was asked. */
export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
