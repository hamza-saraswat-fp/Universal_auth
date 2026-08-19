import { defineConfig } from "tsup";

// Runs after the main build, so `clean` must stay off or it deletes those outputs.
export default defineConfig({
  entry: { react: "src/react.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  // Treeshaking routes output through rollup, which strips module-level
  // directives — and Next.js reads "use client" from the published file, not
  // from source. Without this the React entry is silently treated as a server
  // component in every consuming app. The entry is small; nothing is lost.
  treeshake: false,
  external: [/^next(\/|$)/, /^react(-dom)?(\/|$)/, /^@supabase\//],
  clean: false,
});
