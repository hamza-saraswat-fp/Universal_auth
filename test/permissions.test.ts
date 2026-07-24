import { describe, expect, it } from "vitest";
import { getApps, hasApp, requireApp } from "../src/permissions";
import { AuthError, type FpClaims, type FpRole } from "../src/types";

function claimsWith(apps?: Record<string, FpRole>): FpClaims {
  return {
    sub: "user-1",
    email: "someone@fieldpulse.com",
    exp: 0,
    iat: 0,
    iss: "https://test-project.supabase.co/auth/v1",
    aud: "authenticated",
    ...(apps ? { app_metadata: { apps } } : {}),
  };
}

const admin = claimsWith({ "comp-intel": "admin" });
const member = claimsWith({ "comp-intel": "member" });
const noGrants = claimsWith();

describe("getApps", () => {
  it("returns every grant", () => {
    expect(getApps(claimsWith({ "comp-intel": "admin", "juju-admin": "member" }))).toEqual({
      "comp-intel": "admin",
      "juju-admin": "member",
    });
  });

  it("returns an empty object when the user has no grants", () => {
    // Being signed in says nothing about what you're allowed to use.
    expect(getApps(noGrants)).toEqual({});
  });
});

describe("requireApp", () => {
  it("returns the role held, so callers can branch without a second lookup", () => {
    expect(requireApp(admin, "comp-intel")).toBe("admin");
  });

  it("refuses an app the user has no grant for", () => {
    expect(() => requireApp(admin, "juju-admin")).toThrowError(AuthError);

    try {
      requireApp(admin, "juju-admin");
    } catch (error) {
      expect((error as AuthError).status).toBe(403);
      expect((error as AuthError).code).toBe("forbidden");
    }
  });

  it("refuses a user with no grants at all", () => {
    expect(() => requireApp(noGrants, "comp-intel")).toThrowError(/No access to comp-intel/);
  });

  it("lets an admin satisfy a member requirement", () => {
    expect(requireApp(admin, "comp-intel", "member")).toBe("admin");
  });

  it("does not let a member satisfy an admin requirement", () => {
    expect(() => requireApp(member, "comp-intel", "admin")).toThrowError(
      /has 'member', needs 'admin'/,
    );
  });

  it("accepts an exact role match", () => {
    expect(requireApp(member, "comp-intel", "member")).toBe("member");
    expect(requireApp(admin, "comp-intel", "admin")).toBe("admin");
  });
});

describe("hasApp", () => {
  it("answers without throwing", () => {
    expect(hasApp(admin, "comp-intel")).toBe(true);
    expect(hasApp(admin, "juju-admin")).toBe(false);
    expect(hasApp(noGrants, "comp-intel")).toBe(false);
  });

  it("applies the same role ranking as requireApp", () => {
    expect(hasApp(admin, "comp-intel", "member")).toBe(true);
    expect(hasApp(member, "comp-intel", "admin")).toBe(false);
  });
});
