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

/**
 * Why an `AuthError` was raised. Lets a caller react to the cause rather than
 * pattern-matching on messages.
 *
 * - `expired` — the signature was good but the token is past its expiry. A
 *   session-refresh flow should retry rather than sending the user to log in.
 * - `invalid_token` — malformed, tampered with, signed by an unknown key, or
 *   issued by a different project. Not recoverable by refreshing.
 * - `forbidden` — authenticated, but not permitted to use this app or role.
 * - `unavailable` — the public key set could not be fetched. A transient
 *   problem with the auth project, *not* a problem with the token.
 * - `config` — a required environment variable is missing.
 */
export type AuthErrorCode =
  | "expired"
  | "invalid_token"
  | "forbidden"
  | "unavailable"
  | "config";

/** Thrown when a token is invalid, or valid but not permitted for what was asked. */
export class AuthError extends Error {
  readonly status: number;
  readonly code: AuthErrorCode;

  constructor(
    message: string,
    status = 401,
    code: AuthErrorCode = "invalid_token",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}
