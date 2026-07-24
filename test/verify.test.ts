import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createVerifier, verifyToken } from "../src/verify";
import { AuthError } from "../src/types";
import { createTestKeys, tamper, TEST_ISSUER, TEST_URL, type TestKeys } from "./helpers/tokens";

let keys: TestKeys;
let otherKeys: TestKeys;
let verify: ReturnType<typeof createVerifier>;

beforeAll(async () => {
  keys = await createTestKeys();
  // A second keypair whose public key is never published in `keys.jwks`, for
  // the case where a token is signed by something we don't trust.
  otherKeys = await createTestKeys("other-key");
  verify = createVerifier({ url: TEST_URL, jwks: keys.jwks });
});

afterEach(() => {
  delete process.env.FP_AUTH_URL;
  delete process.env.NEXT_PUBLIC_FP_AUTH_URL;
});

/** Assert a promise rejects with an AuthError carrying the given code and status. */
async function expectAuthError(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toBeInstanceOf(AuthError);
  const error = (await promise.catch((e: unknown) => e)) as AuthError;
  expect({ code: error.code, status: error.status }).toEqual({ code, status });
  return error;
}

describe("a valid token", () => {
  it("returns the claims", async () => {
    const claims = await verify(await keys.sign({ sub: "user-42", email: "dev@fieldpulse.com" }));

    expect(claims.sub).toBe("user-42");
    expect(claims.email).toBe("dev@fieldpulse.com");
    expect(claims.iss).toBe(TEST_ISSUER);
  });

  it("carries per-app roles through from app_metadata", async () => {
    const claims = await verify(
      await keys.sign({ apps: { "comp-intel": "admin", "juju-admin": "member" } }),
    );

    expect(claims.app_metadata?.apps).toEqual({
      "comp-intel": "admin",
      "juju-admin": "member",
    });
  });

  it("has no apps claim when the user has no grants", async () => {
    const claims = await verify(await keys.sign());
    expect(claims.app_metadata?.apps).toBeUndefined();
  });
});

describe("rejecting bad tokens", () => {
  it("reports expiry separately, so a caller can refresh instead of signing the user out", async () => {
    const expired = await keys.sign({ issuedAt: Math.floor(Date.now() / 1000) - 7200 });

    await expectAuthError(verify(expired), "expired", 401);
  });

  it("rejects a token from a different issuer", async () => {
    const token = await keys.sign({ issuer: "https://someone-else.supabase.co/auth/v1" });

    await expectAuthError(verify(token), "invalid_token", 401);
  });

  it("rejects a token minted for a different audience", async () => {
    const token = await keys.sign({ audience: "service_role" });

    await expectAuthError(verify(token), "invalid_token", 401);
  });

  it("rejects a tampered signature", async () => {
    const token = tamper(await keys.sign({ apps: { "comp-intel": "admin" } }));

    await expectAuthError(verify(token), "invalid_token", 401);
  });

  it("rejects a token signed by a key we don't trust", async () => {
    const token = await otherKeys.sign();

    await expectAuthError(verify(token), "invalid_token", 401);
  });

  it("rejects a malformed token", async () => {
    await expectAuthError(verify("not-a-jwt"), "invalid_token", 401);
  });

  it("rejects an empty token without calling out to the key set", async () => {
    await expectAuthError(verify(""), "invalid_token", 401);
  });
});

describe("clock skew", () => {
  it("tolerates a token that expired a moment ago", async () => {
    // Two seconds past expiry, inside the default five-second tolerance.
    const token = await keys.sign({ issuedAt: Math.floor(Date.now() / 1000) - 3602 });

    await expect(verify(token)).resolves.toMatchObject({ email: "someone@fieldpulse.com" });
  });

  it("respects a configured tolerance of zero", async () => {
    const strict = createVerifier({ url: TEST_URL, jwks: keys.jwks, clockTolerance: 0 });
    const token = await keys.sign({ issuedAt: Math.floor(Date.now() / 1000) - 3602 });

    await expectAuthError(strict(token), "expired", 401);
  });
});

describe("configuration", () => {
  it("reads the issuer from the environment when no url is given", async () => {
    process.env.FP_AUTH_URL = TEST_URL;
    const fromEnv = createVerifier({ jwks: keys.jwks });

    await expect(fromEnv(await keys.sign())).resolves.toMatchObject({ iss: TEST_ISSUER });
  });

  it("tolerates a trailing slash on the configured url", async () => {
    const withSlash = createVerifier({ url: `${TEST_URL}/`, jwks: keys.jwks });

    await expect(withSlash(await keys.sign())).resolves.toMatchObject({ iss: TEST_ISSUER });
  });

  it("surfaces a missing environment variable as a config error, not a bad token", async () => {
    await expectAuthError(verifyToken(await keys.sign()), "config", 500);
  });
});
