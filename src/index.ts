/**
 * `@fieldpulse/auth` — core.
 *
 * Framework-agnostic token verification. Runs anywhere with Web Crypto: Node,
 * Vercel edge, Railway services, a bot's HTTP handler.
 *
 * This entry point must never import anything but `jose`. That constraint is
 * what lets a bare backend service verify a token without pulling in a browser
 * auth library or a React runtime.
 */

export { AuthError, ROLE_RANK } from "./types";
export type { FpClaims, FpRole } from "./types";

export { authUrl, publishableKey, issuer, jwksUrl } from "./env";

// TODO(IAI-407): verifyToken(), requireApp(), getApps(), createVerifier().
// Verification checks the signature against the JWKS above, plus `issuer()`
// and an audience of "authenticated".
