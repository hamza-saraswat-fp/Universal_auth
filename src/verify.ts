import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { issuer as defaultIssuer, jwksUrl as defaultJwksUrl } from "./env";
import { AuthError, type FpClaims } from "./types";

/**
 * Supabase issues access tokens with this audience. Checking it stops a token
 * minted for some other purpose from being accepted as a user session.
 */
const ACCESS_TOKEN_AUDIENCE = "authenticated";

/** Seconds of clock skew tolerated between the auth project and this service. */
const DEFAULT_CLOCK_TOLERANCE = 5;

export interface VerifierOptions {
  /**
   * Base URL of the auth project. Defaults to `FP_AUTH_URL`, falling back to
   * `NEXT_PUBLIC_FP_AUTH_URL`.
   */
  url?: string;
  /**
   * Key source. Defaults to the project's public JWKS endpoint. Pass a local
   * key set to verify without network access — used by the test suite.
   */
  jwks?: JWTVerifyGetKey;
  /** Clock skew tolerance in seconds. Defaults to 5. */
  clockTolerance?: number;
}

export type Verifier = (token: string) => Promise<FpClaims>;

/**
 * `createRemoteJWKSet` caches keys internally, so one instance per URL must be
 * reused across calls — building a new one per request would refetch the key
 * set every time.
 */
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeySetFor(url: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(url);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(url));
    remoteKeySets.set(url, keySet);
  }
  return keySet;
}

function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;

  if (error instanceof errors.JWTExpired) {
    return new AuthError("Token has expired", 401, "expired", { cause: error });
  }

  // The key set could not be fetched or had no usable key. That's the auth
  // project being unreachable, not the caller presenting a bad token — callers
  // must not sign people out over it.
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return new AuthError("Could not reach the auth project's key set", 503, "unavailable", {
      cause: error,
    });
  }

  if (error instanceof errors.JOSEError) {
    return new AuthError(`Token verification failed: ${error.message}`, 401, "invalid_token", {
      cause: error,
    });
  }

  // A network failure surfaces as a plain TypeError from fetch rather than a
  // jose error, and means the same thing as a JWKS timeout.
  if (error instanceof TypeError) {
    return new AuthError("Could not reach the auth project's key set", 503, "unavailable", {
      cause: error,
    });
  }

  return new AuthError("Token verification failed", 401, "invalid_token", { cause: error });
}

/**
 * Build a token verifier.
 *
 * Most callers want {@link verifyToken}, which is this function applied to the
 * environment. Use `createVerifier` to point at a different project or to
 * inject a key set.
 */
export function createVerifier(options: VerifierOptions = {}): Verifier {
  const { url, jwks, clockTolerance = DEFAULT_CLOCK_TOLERANCE } = options;

  return async function verify(token: string): Promise<FpClaims> {
    if (!token) {
      throw new AuthError("No token provided", 401, "invalid_token");
    }

    // Resolved per call, not at construction, so importing this module without
    // the environment configured doesn't throw.
    const base = url?.replace(/\/+$/, "");
    const expectedIssuer = base ? `${base}/auth/v1` : defaultIssuer();
    const keySet = jwks ?? remoteKeySetFor(base ? `${base}/auth/v1/.well-known/jwks.json` : defaultJwksUrl());

    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer: expectedIssuer,
        audience: ACCESS_TOKEN_AUDIENCE,
        clockTolerance,
      });
      return payload as unknown as FpClaims;
    } catch (error) {
      throw toAuthError(error);
    }
  };
}

let defaultVerifier: Verifier | undefined;

/**
 * Verify a `fieldpulse-auth` access token: signature, issuer, audience, and
 * expiry. Resolves to the token's claims, including the user's per-app roles.
 *
 * Verification is stateless and needs no API key — the auth project publishes
 * its public keys, so a service that only verifies tokens sets `FP_AUTH_URL`
 * and nothing else.
 *
 * @throws {AuthError} `expired`, `invalid_token`, `unavailable`, or `config`.
 */
export function verifyToken(token: string): Promise<FpClaims> {
  defaultVerifier ??= createVerifier();
  return defaultVerifier(token);
}
