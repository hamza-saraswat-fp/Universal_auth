/**
 * `@fieldpulse/auth` — core.
 *
 * Framework-agnostic token verification. Runs anywhere with Web Crypto: Node,
 * Vercel edge, Railway services, a bot's HTTP handler.
 *
 * This entry point must never import anything but `jose`. That constraint is
 * what lets a bare backend service verify a token without pulling in a browser
 * auth library or a React runtime, and `test/imports.test.ts` enforces it.
 *
 * ```ts
 * const claims = await verifyToken(token);
 * const role = requireApp(claims, "comp-intel", "admin");
 * ```
 */

export { AuthError, ROLE_RANK } from "./types";
export type { AuthErrorCode, FpClaims, FpRole } from "./types";

export { authUrl, configureAuth, publishableKey, issuer, jwksUrl } from "./env";
export type { AuthConfig } from "./env";

export { createVerifier, verifyToken } from "./verify";
export type { Verifier, VerifierOptions } from "./verify";

export { getApps, hasApp, requireApp } from "./permissions";
