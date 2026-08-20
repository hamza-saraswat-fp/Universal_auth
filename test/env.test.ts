import { afterEach, describe, expect, it, vi } from "vitest";
import { authUrl, configureAuth, issuer, jwksUrl, publishableKey } from "../src/env";
import { AuthError } from "../src/types";

const VARS = [
  "FP_AUTH_URL",
  "NEXT_PUBLIC_FP_AUTH_URL",
  "FP_AUTH_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY",
] as const;

afterEach(() => {
  vi.unstubAllGlobals(); // first — process may be stubbed to undefined below
  for (const name of VARS) delete process.env[name];
  configureAuth({ url: undefined, publishableKey: undefined });
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

describe("configureAuth", () => {
  it("takes precedence over every env var", () => {
    process.env.FP_AUTH_URL = "https://env.supabase.co";
    configureAuth({ url: "https://explicit.supabase.co" });
    expect(authUrl()).toBe("https://explicit.supabase.co");
  });

  it("configures the publishable key explicitly", () => {
    configureAuth({ publishableKey: "sb_publishable_explicit" });
    expect(publishableKey()).toBe("sb_publishable_explicit");
  });

  it("clears back to env resolution when a field is set to undefined", () => {
    configureAuth({ url: "https://explicit.supabase.co" });
    process.env.FP_AUTH_URL = "https://env.supabase.co";
    configureAuth({ url: undefined });
    expect(authUrl()).toBe("https://env.supabase.co");
  });

  it("strips trailing slashes from explicit config too", () => {
    configureAuth({ url: "https://explicit.supabase.co//" });
    expect(issuer()).toBe("https://explicit.supabase.co/auth/v1");
  });
});

describe("without process (Vite/CRA browser builds)", () => {
  it("resolution works via configureAuth and never touches process", () => {
    vi.stubGlobal("process", undefined);
    configureAuth({ url: "https://spa.supabase.co", publishableKey: "sb_publishable_spa" });
    expect(authUrl()).toBe("https://spa.supabase.co");
    expect(publishableKey()).toBe("sb_publishable_spa");
  });

  it("throws the config AuthError, not a ReferenceError, when unconfigured", () => {
    vi.stubGlobal("process", undefined);
    expect(() => authUrl()).toThrowError(AuthError);
    try {
      authUrl();
    } catch (error) {
      expect((error as AuthError).code).toBe("config");
      expect((error as AuthError).message).toContain("configureAuth");
    }
  });
});
