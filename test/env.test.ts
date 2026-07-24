import { afterEach, describe, expect, it } from "vitest";
import { authUrl, issuer, jwksUrl, publishableKey } from "../src/env";
import { AuthError } from "../src/types";

const VARS = [
  "FP_AUTH_URL",
  "NEXT_PUBLIC_FP_AUTH_URL",
  "FP_AUTH_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY",
] as const;

afterEach(() => {
  for (const name of VARS) delete process.env[name];
});

describe("authUrl", () => {
  it("reads FP_AUTH_URL", () => {
    process.env.FP_AUTH_URL = "https://abc.supabase.co";
    expect(authUrl()).toBe("https://abc.supabase.co");
  });

  it("falls back to the NEXT_PUBLIC_ variant so browser and server share one value", () => {
    process.env.NEXT_PUBLIC_FP_AUTH_URL = "https://abc.supabase.co";
    expect(authUrl()).toBe("https://abc.supabase.co");
  });

  it("prefers the server-only variable when both are set", () => {
    process.env.FP_AUTH_URL = "https://server.supabase.co";
    process.env.NEXT_PUBLIC_FP_AUTH_URL = "https://public.supabase.co";
    expect(authUrl()).toBe("https://server.supabase.co");
  });

  it("strips trailing slashes, which would otherwise corrupt the issuer claim", () => {
    process.env.FP_AUTH_URL = "https://abc.supabase.co//";
    expect(issuer()).toBe("https://abc.supabase.co/auth/v1");
  });

  it("throws a 500 when unset rather than silently verifying against nothing", () => {
    expect(() => authUrl()).toThrowError(AuthError);
    try {
      authUrl();
    } catch (error) {
      expect((error as AuthError).status).toBe(500);
    }
  });
});

describe("jwksUrl", () => {
  it("points at the public key set", () => {
    process.env.FP_AUTH_URL = "https://abc.supabase.co";
    expect(jwksUrl()).toBe("https://abc.supabase.co/auth/v1/.well-known/jwks.json");
  });
});

describe("publishableKey", () => {
  it("reads either variant", () => {
    process.env.NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY = "sb_publishable_test";
    expect(publishableKey()).toBe("sb_publishable_test");
  });

  it("throws when unset", () => {
    expect(() => publishableKey()).toThrowError(AuthError);
  });
});
