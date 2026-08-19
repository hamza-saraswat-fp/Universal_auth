import { defineConfig } from "tsup";

// Server-side entries. The React entry builds separately (tsup.react.config.ts)
// because it needs a "use client" banner, and a single config can't apply a
// banner to just one entry.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    next: "src/next.ts",
    "next/callback": "src/next/callback.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  // Framework packages are peer deps — never bundle them, or consuming apps
  // end up with two copies of React or the Supabase client. Regexes so that
  // subpath imports (next/server, next/headers, react/jsx-runtime) stay
  // external too; a bare "next" string would not cover them.
  external: [/^next(\/|$)/, /^react(-dom)?(\/|$)/, /^@supabase\//],
  clean: true,
});
