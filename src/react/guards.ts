/**
 * Route/tree guards for apps without a server — Vite/CRA SPAs — or anywhere a
 * component-level gate is more convenient than the Next.js proxy.
 *
 * These are RENDERING gates. In an SPA there is no server to enforce anything,
 * so what these buy you is "only signed-in FieldPulse employees see the app
 * shell" — data-layer protection is its own concern (the app's own backend or
 * database policies).
 */

import { createElement, useState, type CSSProperties, type ReactNode } from "react";
import { hasApp } from "../permissions";
import type { FpRole } from "../types";
import { signInWithGoogle, signOut, useAuth, useAuthClient } from "./auth-context";

export interface RequireAuthProps {
  children: ReactNode;
  /** Rendered while the session is resolving. Default: nothing (no flash). */
  loading?: ReactNode;
  /** Replaces the built-in sign-in screen. */
  signedOut?: ReactNode;
  /** Shown on the built-in screens, e.g. "Juju Dashboard". */
  appName?: string;
}

/**
 * Renders children only for a signed-in FieldPulse employee — the default
 * access policy, needing no permission rows at all. Signed-out visitors get a
 * minimal built-in sign-in screen that returns them to the URL they were on.
 *
 * ```tsx
 * <FpAuthProvider>
 *   <RequireAuth appName="Juju Dashboard">
 *     <App />
 *   </RequireAuth>
 * </FpAuthProvider>
 * ```
 */
export function RequireAuth({ children, loading = null, signedOut, appName }: RequireAuthProps) {
  const { status } = useAuth();

  if (status === "loading") return createElement(Frag, null, loading);
  if (status === "signed-out") {
    return createElement(Frag, null, signedOut ?? createElement(SignInScreen, { appName }));
  }
  return createElement(Frag, null, children);
}

export interface RequireAppProps extends RequireAuthProps {
  /** App slug in `app_permissions`. */
  app: string;
  /** Minimum role. `admin` satisfies `"member"`. */
  role?: FpRole;
  /** Who to ask for access — a name or Slack channel, shown on the built-in screen. */
  contact?: string;
  /** Replaces the built-in no-access screen. */
  noAccess?: ReactNode;
}

/**
 * Grant-controlled variant: signed in AND holding a grant for `app` (at
 * `role` or above). Everyone else sees who to ask, not a broken page.
 */
export function RequireApp({
  children,
  loading = null,
  signedOut,
  appName,
  app,
  role,
  contact,
  noAccess,
}: RequireAppProps) {
  const { status, claims, user } = useAuth();

  if (status === "loading") return createElement(Frag, null, loading);
  if (status === "signed-out") {
    return createElement(Frag, null, signedOut ?? createElement(SignInScreen, { appName }));
  }
  if (!claims || !hasApp(claims, app, role)) {
    return createElement(
      Frag,
      null,
      noAccess ??
        createElement(NoAccessScreen, {
          app: appName ?? app,
          contact,
          email: user?.email,
        }),
    );
  }
  return createElement(Frag, null, children);
}

/** Fragment alias so children of any shape render without wrapper elements. */
function Frag({ children }: { children?: ReactNode }) {
  return createElement("span", { style: { display: "contents" } }, children);
}

const screenStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "24px",
};

const cardStyle: CSSProperties = { textAlign: "center", maxWidth: "380px" };

const buttonStyle: CSSProperties = {
  marginTop: "16px",
  padding: "10px 20px",
  fontSize: "15px",
  borderRadius: "8px",
  border: "1px solid #d0d0d5",
  background: "#fff",
  color: "#1a1a1e",
  cursor: "pointer",
};

const mutedStyle: CSSProperties = { color: "#71717a", fontSize: "14px", lineHeight: 1.5 };

function SignInScreen({ appName }: { appName?: string }) {
  const client = useAuthClient();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    signInWithGoogle({ client, redirectTo: window.location.href }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
    });
  };

  return createElement(
    "div",
    { style: screenStyle },
    createElement(
      "div",
      { style: cardStyle },
      createElement(
        "h1",
        { style: { fontSize: "20px", marginBottom: "8px" } },
        appName ?? "Sign in",
      ),
      createElement(
        "p",
        { style: mutedStyle },
        "Use your FieldPulse Google account to continue.",
      ),
      createElement("button", { style: buttonStyle, onClick }, "Sign in with Google"),
      error ? createElement("p", { style: { ...mutedStyle, color: "#b91c1c" } }, error) : null,
    ),
  );
}

function NoAccessScreen({
  app,
  contact,
  email,
}: {
  app: string;
  contact?: string;
  email?: string;
}) {
  const client = useAuthClient();

  return createElement(
    "div",
    { style: screenStyle },
    createElement(
      "div",
      { style: cardStyle },
      createElement("h1", { style: { fontSize: "20px", marginBottom: "8px" } }, "No access"),
      createElement(
        "p",
        { style: mutedStyle },
        email ? `You're signed in as ${email}, ` : "You're signed in, ",
        `but this account doesn't have access to ${app}.`,
        contact ? ` Ask ${contact} to grant you access.` : "",
      ),
      createElement(
        "button",
        {
          style: buttonStyle,
          onClick: () => void signOut({ client, redirectTo: window.location.href }),
        },
        "Switch account",
      ),
    ),
  );
}
