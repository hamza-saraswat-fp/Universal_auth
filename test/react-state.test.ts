import { beforeAll, describe, expect, it } from "vitest";
import {
  buildSignInRedirect,
  snapshotFromToken,
  toFpUser,
} from "../src/react/state";
import type { FpClaims } from "../src/types";
import { createTestKeys, type TestKeys } from "./helpers/tokens";

let keys: TestKeys;

beforeAll(async () => {
  keys = await createTestKeys();
});

describe("snapshotFromToken", () => {
  it("decodes a real token into a signed-in snapshot with claims and user", async () => {
    const token = await keys.sign({
      sub: "user-9",
      email: "dev@fieldpulse.com",
      apps: { "comp-intel": "admin" },
      claims: { user_metadata: { full_name: "Dev Person", avatar_url: "https://img/x.png" } },
    });

    const snapshot = snapshotFromToken(token);

    expect(snapshot.status).toBe("signed-in");
    expect(snapshot.claims?.app_metadata?.apps).toEqual({ "comp-intel": "admin" });
    expect(snapshot.user).toEqual({
      id: "user-9",
      email: "dev@fieldpulse.com",
      name: "Dev Person",
      avatarUrl: "https://img/x.png",
    });
  });

  it("treats a missing token as signed out", () => {
    expect(snapshotFromToken(null).status).toBe("signed-out");
    expect(snapshotFromToken(undefined).status).toBe("signed-out");
    expect(snapshotFromToken("").status).toBe("signed-out");
  });

  it("treats an unparseable token as signed out rather than crashing the tree", () => {
    const snapshot = snapshotFromToken("garbage.not-a.jwt");
    expect(snapshot.status).toBe("signed-out");
    expect(snapshot.user).toBeNull();
  });
});

describe("toFpUser", () => {
  function claims(meta?: Record<string, unknown>): FpClaims {
    return {
      sub: "u1",
      email: "x@fieldpulse.com",
      exp: 0,
      iat: 0,
      iss: "i",
      aud: "authenticated",
      ...(meta ? { user_metadata: meta } : {}),
    };
  }

  it("prefers full_name, falls back to name, then leaves name unset", () => {
    expect(toFpUser(claims({ full_name: "Full", name: "Short" })).name).toBe("Full");
    expect(toFpUser(claims({ name: "Short" })).name).toBe("Short");
    expect(toFpUser(claims()).name).toBeUndefined();
  });

  it("falls back from avatar_url to picture", () => {
    expect(toFpUser(claims({ picture: "https://img/p.png" })).avatarUrl).toBe(
      "https://img/p.png",
    );
  });
});

describe("buildSignInRedirect", () => {
  const at = (pathname: string, search = "") => ({
    origin: "https://app.fieldpulse.dev",
    pathname,
    search,
  });

  it("defaults next to the current page, query string included", () => {
    expect(buildSignInRedirect(at("/reports", "?week=32"))).toBe(
      "https://app.fieldpulse.dev/auth/callback?next=%2Freports%3Fweek%3D32",
    );
  });

  it("omits the next param from the root page — the callback's default is already /", () => {
    expect(buildSignInRedirect(at("/"))).toBe("https://app.fieldpulse.dev/auth/callback");
  });

  it("honors an explicit next", () => {
    expect(buildSignInRedirect(at("/login"), { next: "/dashboard" })).toBe(
      "https://app.fieldpulse.dev/auth/callback?next=%2Fdashboard",
    );
  });

  it("lets redirectTo override everything", () => {
    expect(buildSignInRedirect(at("/x"), { redirectTo: "https://other.fieldpulse.dev/auth/callback" })).toBe(
      "https://other.fieldpulse.dev/auth/callback",
    );
  });
});
