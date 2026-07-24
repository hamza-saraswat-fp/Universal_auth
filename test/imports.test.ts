import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The core entry point must import `jose` and nothing else — that constraint is
 * what lets a bare backend service verify a token without pulling in a browser
 * auth library or a React runtime.
 *
 * A stray `import { createServerClient } from "@supabase/ssr"` in a core file
 * is easy to add and hard to notice, so this walks the actual import graph
 * rather than trusting review to catch it.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = resolve(ROOT, "src/index.ts");

const ALLOWED = new Set(["jose"]);

/** Strip comments so a code sample in a doc block can't look like an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collect(
  file: string,
  externals = new Map<string, string[]>(),
  seen = new Set<string>(),
): Map<string, string[]> {
  const path = file.endsWith(".ts") ? file : `${file}.ts`;
  if (seen.has(path)) return externals;
  seen.add(path);

  const source = stripComments(readFileSync(path, "utf8"));

  for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier) continue;

    if (specifier.startsWith(".")) {
      collect(resolve(dirname(path), specifier), externals, seen);
    } else {
      const importers = externals.get(specifier) ?? [];
      importers.push(relative(ROOT, path));
      externals.set(specifier, importers);
    }
  }

  return externals;
}

describe("core entry point dependencies", () => {
  it("imports nothing but jose", () => {
    const externals = collect(ENTRY);
    const offenders = [...externals.entries()].filter(([specifier]) => !ALLOWED.has(specifier));

    expect(
      offenders.map(([specifier, importers]) => `${specifier} (imported by ${importers.join(", ")})`),
    ).toEqual([]);
  });

  it("actually reaches the modules it is meant to be checking", () => {
    // Guards the guard: if the graph walk silently found nothing, the test
    // above would pass no matter what anyone imported.
    const seen = new Set<string>();
    collect(ENTRY, new Map(), seen);

    const files = [...seen].map((path) => relative(ROOT, path)).sort();
    expect(files).toEqual([
      "src/env.ts",
      "src/index.ts",
      "src/permissions.ts",
      "src/types.ts",
      "src/verify.ts",
    ]);
  });
});
