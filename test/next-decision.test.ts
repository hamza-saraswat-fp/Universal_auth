import { describe, expect, it } from "vitest";
import { resolveConfig, resolveProxyDecision } from "../src/next/decision";
import type { FpClaims, FpRole } from "../src/types";

function claimsWith(apps?: Record<string, FpRole>): FpClaims {
  return {
    sub: "user-1",
    email: "someone@fieldpulse.com",
    exp: 0,
    iat: 0,
    iss: "https://test.supabase.co/auth/v1",
    aud: "authenticated",
    ...(apps ? { app_metadata: { apps } } : {}),
  };
}

const cfg = resolveConfig({ app: "comp-intel" });
const signedOut = null;
const member = claimsWith({ "comp-intel": "member" });
const admin = claimsWith({ "comp-intel": "admin" });
const otherApp = claimsWith({ "juju-admin": "admin" });

describe("signed out", () => {
  it("redirects protected paths to the login page", () => {
    expect(resolveProxyDecision(signedOut, "/dashboard", cfg)).toEqual({
      action: "redirect",
      to: "/login",
    });
  });

  it("passes the login page itself — no redirect loop", () => {
    expect(resolveProxyDecision(signedOut, "/login", cfg)).toEqual({ action: "pass" });
  });

  it("passes the auth callback and error routes", () => {
    expect(resolveProxyDecision(signedOut, "/auth/callback", cfg)).toEqual({ action: "pass" });
    expect(resolveProxyDecision(signedOut, "/auth/error", cfg)).toEqual({ action: "pass" });
  });

  it("passes extra public prefixes", () => {
    const withPublic = resolveConfig({ app: "comp-intel", publicPaths: ["/api/health"] });
    expect(resolveProxyDecision(signedOut, "/api/health", withPublic)).toEqual({
      action: "pass",
    });
  });
});

describe("signed in", () => {
  it("passes a user holding a grant for the app", () => {
    expect(resolveProxyDecision(member, "/dashboard", cfg)).toEqual({ action: "pass" });
  });

  it("sends a user without a grant to /no-access, not to login", () => {
    expect(resolveProxyDecision(otherApp, "/dashboard", cfg)).toEqual({
      action: "redirect",
      to: "/no-access",
    });
  });

  it("passes /no-access itself for the unpermitted — no redirect loop", () => {
    expect(resolveProxyDecision(otherApp, "/no-access", cfg)).toEqual({ action: "pass" });
  });

  it("enforces a minimum role when configured", () => {
    const adminOnly = resolveConfig({ app: "comp-intel", role: "admin" });
    expect(resolveProxyDecision(member, "/dashboard", adminOnly)).toEqual({
      action: "redirect",
      to: "/no-access",
    });
    expect(resolveProxyDecision(admin, "/dashboard", adminOnly)).toEqual({ action: "pass" });
  });

  it("admin satisfies a member-level app requirement", () => {
    const memberLevel = resolveConfig({ app: "comp-intel", role: "member" });
    expect(resolveProxyDecision(admin, "/dashboard", memberLevel)).toEqual({ action: "pass" });
  });

  it("without an app slug, any signed-in user passes", () => {
    const sessionOnly = resolveConfig({});
    expect(resolveProxyDecision(otherApp, "/dashboard", sessionOnly)).toEqual({
      action: "pass",
    });
  });
});

describe("path matching", () => {
  it("matches prefixes on segment boundaries only", () => {
    // "/auth" must not make "/authx" public
    expect(resolveProxyDecision(signedOut, "/authx", cfg)).toEqual({
      action: "redirect",
      to: "/login",
    });
    // "/login" must not make "/login-history" public
    expect(resolveProxyDecision(signedOut, "/login-history", cfg)).toEqual({
      action: "redirect",
      to: "/login",
    });
  });

  it("respects custom login and no-access paths, keeping them public", () => {
    const custom = resolveConfig({
      app: "comp-intel",
      loginPath: "/signin",
      noAccessPath: "/request-access",
    });
    expect(resolveProxyDecision(signedOut, "/dashboard", custom)).toEqual({
      action: "redirect",
      to: "/signin",
    });
    expect(resolveProxyDecision(signedOut, "/signin", custom)).toEqual({ action: "pass" });
    expect(resolveProxyDecision(otherApp, "/dashboard", custom)).toEqual({
      action: "redirect",
      to: "/request-access",
    });
    expect(resolveProxyDecision(otherApp, "/request-access", custom)).toEqual({
      action: "pass",
    });
  });
});
