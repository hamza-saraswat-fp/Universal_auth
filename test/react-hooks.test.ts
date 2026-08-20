// @vitest-environment happy-dom
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FpAuthProvider, useAppRole, useAuth, useUser } from "../src/react";
import { mockClient } from "./helpers/mock-supabase";
import { createTestKeys, type TestKeys } from "./helpers/tokens";

let keys: TestKeys;

afterEach(cleanup);

beforeAll(async () => {
  keys = await createTestKeys();
});

function wrapperWith(client: SupabaseClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(FpAuthProvider, { client, children });
}

describe("FpAuthProvider state transitions", () => {
  it("starts loading, then resolves to signed-out — two distinct states", async () => {
    const { client } = mockClient(null);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperWith(client) });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.user).toBeNull();
  });

  it("hydrates from a stored session without a signed-out flash", async () => {
    const token = await keys.sign({ sub: "user-1", email: "dev@fieldpulse.com" });
    const { client } = mockClient(token);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(result.current.status).toBe("signed-in"));
    expect(result.current.user?.email).toBe("dev@fieldpulse.com");
  });

  it("follows sign-in and sign-out events", async () => {
    const mock = mockClient(null);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperWith(mock.client) });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    mock.emit("SIGNED_IN", await keys.sign({ email: "dev@fieldpulse.com" }));
    expect(result.current.status).toBe("signed-in");

    mock.emit("SIGNED_OUT", null);
    expect(result.current.status).toBe("signed-out");
    expect(result.current.claims).toBeNull();
  });

  it("unsubscribes on unmount", async () => {
    const mock = mockClient(null);
    const { unmount } = renderHook(() => useAuth(), { wrapper: wrapperWith(mock.client) });
    unmount();
    expect(mock.unsubscribe).toHaveBeenCalled();
  });
});

describe("useUser / useAppRole", () => {
  it("expose identity and role from the token's claims", async () => {
    const token = await keys.sign({
      sub: "user-7",
      email: "dev@fieldpulse.com",
      apps: { "comp-intel": "admin" },
      claims: { user_metadata: { full_name: "Dev Person" } },
    });
    const { client } = mockClient(token);

    const { result } = renderHook(
      () => ({ user: useUser(), role: useAppRole("comp-intel"), other: useAppRole("juju-admin") }),
      { wrapper: wrapperWith(client) },
    );

    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user).toMatchObject({ id: "user-7", name: "Dev Person" });
    expect(result.current.role).toBe("admin");
    expect(result.current.other).toBeNull();
  });

  it("drops the role when a refreshed token no longer carries the grant", async () => {
    const withGrant = await keys.sign({ apps: { "comp-intel": "member" } });
    const mock = mockClient(withGrant);
    const { result } = renderHook(() => useAppRole("comp-intel"), {
      wrapper: wrapperWith(mock.client),
    });
    await waitFor(() => expect(result.current).toBe("member"));

    mock.emit("TOKEN_REFRESHED", await keys.sign({}));
    expect(result.current).toBeNull();
  });

  it("throws a pointed error outside the provider", () => {
    expect(() => renderHook(() => useUser())).toThrowError(/FpAuthProvider/);
  });
});
