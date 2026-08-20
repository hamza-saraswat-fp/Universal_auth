import type { SupabaseClient } from "@supabase/supabase-js";
import { act } from "@testing-library/react";
import { vi } from "vitest";

export type AuthCallback = (event: string, session: { access_token: string } | null) => void;

/** A Supabase client stub exposing exactly what the provider and guards touch. */
export function mockClient(initialToken: string | null = null) {
  let callback: AuthCallback = () => {};
  const unsubscribe = vi.fn();
  const signInWithOAuth = vi.fn(async (_options: unknown) => ({ data: { provider: "google", url: "" }, error: null }));
  const signOut = vi.fn(async () => ({ error: null }));

  const client = {
    auth: {
      getSession: async () => ({
        data: { session: initialToken ? { access_token: initialToken } : null },
        error: null,
      }),
      onAuthStateChange: (cb: AuthCallback) => {
        callback = cb;
        return { data: { subscription: { unsubscribe } } };
      },
      signInWithOAuth,
      signOut,
    },
  } as unknown as SupabaseClient;

  return {
    client,
    unsubscribe,
    signInWithOAuth,
    signOut,
    emit: (event: string, token: string | null) =>
      act(() => callback(event, token ? { access_token: token } : null)),
  };
}
