import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import type { FpRole } from "../../src/types";

/**
 * Signs tokens with a keypair generated in-process and verifies them against a
 * local key set. No network, and nothing that expires between test runs.
 */

export const TEST_URL = "https://test-project.supabase.co";
export const TEST_ISSUER = `${TEST_URL}/auth/v1`;

const ALG = "ES256";

export interface SignOptions {
  sub?: string;
  email?: string;
  apps?: Record<string, FpRole>;
  issuer?: string;
  audience?: string;
  /** Lifetime in seconds relative to `issuedAt`. Negative values produce an expired token. */
  lifetime?: number;
  /** Epoch seconds. Defaults to now. */
  issuedAt?: number;
  /** Extra claims merged into the payload (e.g. user_metadata). */
  claims?: Record<string, unknown>;
}

export interface TestKeys {
  kid: string;
  jwks: JWTVerifyGetKey;
  sign(options?: SignOptions): Promise<string>;
}

export async function createTestKeys(kid = "test-key"): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });

  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = ALG;

  const jwks = createLocalJWKSet({ keys: [publicJwk] } as JSONWebKeySet);

  async function sign(options: SignOptions = {}): Promise<string> {
    const {
      sub = "00000000-0000-4000-8000-000000000001",
      email = "someone@fieldpulse.com",
      apps,
      issuer = TEST_ISSUER,
      audience = "authenticated",
      lifetime = 3600,
      issuedAt = Math.floor(Date.now() / 1000),
      claims = {},
    } = options;

    return new SignJWT({
      email,
      session_id: "session-1",
      ...(apps ? { app_metadata: { apps } } : {}),
      ...claims,
    })
      .setProtectedHeader({ alg: ALG, kid })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetime)
      .sign(privateKey);
  }

  return { kid, jwks, sign };
}

/** Corrupt a token's signature while leaving its header and payload intact. */
export function tamper(token: string): string {
  const [header, payload, signature] = token.split(".");
  const flipped = signature?.startsWith("A") ? `B${signature.slice(1)}` : `A${signature?.slice(1)}`;
  return `${header}.${payload}.${flipped}`;
}
