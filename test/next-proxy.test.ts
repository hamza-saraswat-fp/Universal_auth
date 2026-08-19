import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthProxy } from "../src/next";
import { bridgeCookies } from "../src/next/cookies";

const TEST_URL = "https://test-project.supabase.co";

beforeEach(() => {
  process.env.FP_AUTH_URL = TEST_URL;
  process.env.FP_AUTH_PUBLISHABLE_KEY = "sb_publishable_test";
});

afterEach(() => {
  delete process.env.FP_AUTH_URL;
  delete process.env.FP_AUTH_PUBLISHABLE_KEY;
});

describe("proxy with no session cookies (signed out)", () => {
  // No cookies means getClaims() resolves locally with no session and no
  // network call, so the full proxy runs end to end in the test.

  it("redirects a protected path to /login, carrying the path decision end to end", async () => {
    const proxy = createAuthProxy({ app: "comp-intel" });
    const response = await proxy(new NextRequest("https://app.fieldpulse.dev/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.fieldpulse.dev/login");
  });

  it("passes public paths straight through", async () => {
    const proxy = createAuthProxy({ app: "comp-intel" });
    for (const path of ["/login", "/no-access", "/auth/callback"]) {
      const response = await proxy(new NextRequest(`https://app.fieldpulse.dev${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("redirects to a custom login path when configured", async () => {
    const proxy = createAuthProxy({ loginPath: "/signin" });
    const response = await proxy(new NextRequest("https://app.fieldpulse.dev/anything"));

    expect(response.headers.get("location")).toBe("https://app.fieldpulse.dev/signin");
  });
});

describe("bridgeCookies", () => {
  // Exercises the cookie/header contract directly, since a real token refresh
  // (which is what invokes setAll in production) needs a live auth server.

  const cookiesToSet = [
    { name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } },
  ];
  const cacheHeaders = {
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  };

  it("writes refreshed cookies to request and response, and applies the anti-caching headers", async () => {
    const request = new NextRequest("https://app.fieldpulse.dev/dashboard");
    const bridge = bridgeCookies(request);

    await bridge.cookieMethods.setAll?.(cookiesToSet, cacheHeaders);

    // Request side: how the refreshed token reaches Server Components.
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    // Response side: how it reaches the browser.
    expect(bridge.response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    // Headers: what stops a CDN caching one user's session for another.
    expect(bridge.response.headers.get("Cache-Control")).toContain("no-store");
    expect(bridge.response.headers.get("Pragma")).toBe("no-cache");
  });

  it("carries cookies and headers onto a replacement response (the redirect case)", async () => {
    const request = new NextRequest("https://app.fieldpulse.dev/dashboard");
    const bridge = bridgeCookies(request);
    await bridge.cookieMethods.setAll?.(cookiesToSet, cacheHeaders);

    const redirect = bridge.applyTo(
      NextResponse.redirect("https://app.fieldpulse.dev/login"),
    );

    expect(redirect.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(redirect.headers.get("Cache-Control")).toContain("no-store");
  });

  it("tolerates older ssr versions that pass no headers argument", async () => {
    const request = new NextRequest("https://app.fieldpulse.dev/dashboard");
    const bridge = bridgeCookies(request);

    // @ts-expect-error -- simulating @supabase/ssr < 0.10, which called setAll with one argument
    await bridge.cookieMethods.setAll?.(cookiesToSet);

    expect(bridge.response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });
});
