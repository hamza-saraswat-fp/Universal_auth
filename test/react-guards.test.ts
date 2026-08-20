// @vitest-environment happy-dom
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FpAuthProvider, RequireApp, RequireAuth } from "../src/react";
import { mockClient } from "./helpers/mock-supabase";
import { createTestKeys, type TestKeys } from "./helpers/tokens";

let keys: TestKeys;

// Without vitest globals, testing-library cannot register its own auto-cleanup.
afterEach(cleanup);

beforeAll(async () => {
  keys = await createTestKeys();
});

function providerTree(client: SupabaseClient, children: ReactNode) {
  return createElement(FpAuthProvider, { client, children });
}

const APP_CONTENT = createElement("div", null, "the actual app");

const signInButton = () => screen.getByRole("button", { name: /sign in with google/i });
const querySignInButton = () => screen.queryByRole("button", { name: /sign in with google/i });

describe("RequireAuth", () => {
  it("renders nothing while loading — never a sign-in flash", () => {
    const { client } = mockClient(null);
    render(providerTree(client, createElement(RequireAuth, { children: APP_CONTENT })));

    // getSession hasn't resolved yet: neither the app nor the sign-in screen.
    expect(screen.queryByText("the actual app")).toBeNull();
    expect(querySignInButton()).toBeNull();
  });

  it("renders the loading slot when given", () => {
    const { client } = mockClient(null);
    render(
      providerTree(
        client,
        createElement(RequireAuth, {
          loading: createElement("div", null, "spinner…"),
          children: APP_CONTENT,
        }),
      ),
    );
    expect(screen.getByText("spinner…")).toBeTruthy();
  });

  it("shows the built-in sign-in screen when signed out", async () => {
    const { client } = mockClient(null);
    render(
      providerTree(
        client,
        createElement(RequireAuth, { appName: "Juju Dashboard", children: APP_CONTENT }),
      ),
    );

    await waitFor(() => expect(signInButton()).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Juju Dashboard" })).toBeTruthy();
    expect(screen.queryByText("the actual app")).toBeNull();
  });

  it("sign-in button starts the OAuth flow, returning to the current URL", async () => {
    const mock = mockClient(null);
    render(providerTree(mock.client, createElement(RequireAuth, { children: APP_CONTENT })));
    await waitFor(() => expect(signInButton()).toBeTruthy());

    fireEvent.click(signInButton());

    await waitFor(() => expect(mock.signInWithOAuth).toHaveBeenCalledOnce());
    const call = mock.signInWithOAuth.mock.calls[0]?.[0] as {
      provider: string;
      options: { redirectTo: string; queryParams: Record<string, string> };
    };
    expect(call.provider).toBe("google");
    expect(call.options.redirectTo).toBe(window.location.href);
    expect(call.options.queryParams.hd).toBe("fieldpulse.com");
  });

  it("renders a custom signedOut slot instead of the built-in screen", async () => {
    const { client } = mockClient(null);
    render(
      providerTree(
        client,
        createElement(RequireAuth, {
          signedOut: createElement("div", null, "custom gate"),
          children: APP_CONTENT,
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("custom gate")).toBeTruthy());
    expect(querySignInButton()).toBeNull();
  });

  it("renders children for any signed-in employee — no grants involved", async () => {
    const token = await keys.sign({ email: "dev@fieldpulse.com" }); // zero apps
    const { client } = mockClient(token);
    render(providerTree(client, createElement(RequireAuth, { children: APP_CONTENT })));

    await waitFor(() => expect(screen.getByText("the actual app")).toBeTruthy());
  });

  it("drops to the sign-in screen on SIGNED_OUT", async () => {
    const mock = mockClient(await keys.sign({}));
    render(providerTree(mock.client, createElement(RequireAuth, { children: APP_CONTENT })));
    await waitFor(() => expect(screen.getByText("the actual app")).toBeTruthy());

    mock.emit("SIGNED_OUT", null);
    await waitFor(() => expect(signInButton()).toBeTruthy());
  });

  it("works under StrictMode double-mounting", async () => {
    const mock = mockClient(await keys.sign({ email: "dev@fieldpulse.com" }));
    render(
      createElement(
        StrictMode,
        null,
        providerTree(mock.client, createElement(RequireAuth, { children: APP_CONTENT })),
      ),
    );
    await waitFor(() => expect(screen.getByText("the actual app")).toBeTruthy());
    // Strict mode mounts, unmounts, remounts: the first subscription must be cleaned up.
    expect(mock.unsubscribe).toHaveBeenCalled();
    // And the surviving subscription still drives state.
    mock.emit("SIGNED_OUT", null);
    await waitFor(() => expect(signInButton()).toBeTruthy());
  });
});

describe("RequireApp", () => {
  it("renders children when the grant satisfies the role (admin covers member)", async () => {
    const token = await keys.sign({ apps: { "comp-intel": "admin" } });
    const { client } = mockClient(token);
    render(
      providerTree(
        client,
        createElement(RequireApp, { app: "comp-intel", role: "member", children: APP_CONTENT }),
      ),
    );
    await waitFor(() => expect(screen.getByText("the actual app")).toBeTruthy());
  });

  it("shows the no-access screen for a signed-in user without the grant", async () => {
    const token = await keys.sign({ email: "dev@fieldpulse.com", apps: { other: "admin" } });
    const { client } = mockClient(token);
    render(
      providerTree(
        client,
        createElement(RequireApp, {
          app: "comp-intel",
          appName: "Comp Intel",
          contact: "#help-internal-ai",
          children: APP_CONTENT,
        }),
      ),
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "No access" })).toBeTruthy());
    const message = screen.getByText(
      (_, element) =>
        element?.tagName === "P" &&
        /doesn't have access to Comp Intel/.test(element.textContent ?? ""),
    );
    expect(message.textContent).toContain("dev@fieldpulse.com");
    expect(message.textContent).toContain("#help-internal-ai");
    expect(screen.queryByText("the actual app")).toBeNull();
  });

  it("refuses an insufficient role", async () => {
    const token = await keys.sign({ apps: { "comp-intel": "member" } });
    const { client } = mockClient(token);
    render(
      providerTree(
        client,
        createElement(RequireApp, { app: "comp-intel", role: "admin", children: APP_CONTENT }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "No access" })).toBeTruthy());
  });

  it("renders a custom noAccess slot", async () => {
    const token = await keys.sign({});
    const { client } = mockClient(token);
    render(
      providerTree(
        client,
        createElement(RequireApp, {
          app: "comp-intel",
          noAccess: createElement("div", null, "ask nicely"),
          children: APP_CONTENT,
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("ask nicely")).toBeTruthy());
  });

  it("still gates sign-in first — signed-out users see the sign-in screen, not no-access", async () => {
    const { client } = mockClient(null);
    render(
      providerTree(client, createElement(RequireApp, { app: "comp-intel", children: APP_CONTENT })),
    );
    await waitFor(() => expect(signInButton()).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "No access" })).toBeNull();
  });
});
