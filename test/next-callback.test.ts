import { afterEach, describe, expect, it } from "vitest";
import { createCallbackRoute, sanitizeNext } from "../src/next/callback";

describe("sanitizeNext", () => {
  it("keeps ordinary same-origin paths", () => {
    expect(sanitizeNext("/dashboard")).toBe("/dashboard");
    expect(sanitizeNext("/a/b?c=d")).toBe("/a/b?c=d");
  });

  it("defaults to / when absent or not a path", () => {
    expect(sanitizeNext(null)).toBe("/");
    expect(sanitizeNext("")).toBe("/");
    expect(sanitizeNext("https://evil.com")).toBe("/");
    expect(sanitizeNext("dashboard")).toBe("/");
  });

  it("rejects protocol-relative escapes — the open-redirect vector", () => {
    expect(sanitizeNext("//evil.com")).toBe("/");
    expect(sanitizeNext("/\\evil.com")).toBe("/");
  });
});

describe("callback route", () => {
  afterEach(() => {
    delete process.env.FP_AUTH_URL;
    delete process.env.NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY;
  });

  it("redirects to the error page when no code is present", async () => {
    const GET = createCallbackRoute();
    const response = await GET(new Request("https://app.fieldpulse.dev/auth/callback"));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toBe("https://app.fieldpulse.dev/auth/error");
  });

  it("honors a custom error path", async () => {
    const GET = createCallbackRoute({ errorPath: "/oops" });
    const response = await GET(new Request("https://app.fieldpulse.dev/auth/callback"));

    expect(response.headers.get("location")).toBe("https://app.fieldpulse.dev/oops");
  });
});
