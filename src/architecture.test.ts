/**
 * Layer-boundary guard (onion architecture: dependencies point inward).
 *
 * Statically scans each layer's source for imports that break the inward-only
 * rule, so an accidental pi runtime import in domain fails CI instead of
 * review. Tiers, outermost to innermost:
 *
 *   adapters  ->  infra  ->  domain
 *        \\---------------->/
 *
 *   - domain      pure: no pi runtime, no fs/process I/O, no outward imports.
 *   - infra       concrete I/O: may use pi/libs and domain, but never adapters.
 *   - adapters    the pi-facing ring: unrestricted (not scanned here).
 *
 * type-only imports (`import type ...`) carry no runtime dependency and are allowed
 * everywhere.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const LAYERS = ["domain", "adapters", "infra"] as const;
const PI_RUNTIME = /^@earendil-works\//;
const IO_BUILTIN = /^node:(?:fs|fs\/promises|child_process)$/;

function collectSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...collectSources(full));
        else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

/** Every `import`/`export ... from "spec"` in the source, with its type-only flag. */
function moduleRefs(source: string): Array<{ typeOnly: boolean; spec: string }> {
    const pattern = /(?:import|export)\s+(type\s+)?[\s\S]*?from\s*["']([^"']+)["']/g;
    const refs: Array<{ typeOnly: boolean; spec: string }> = [];
    for (const match of source.matchAll(pattern)) {
        refs.push({ typeOnly: match[1] !== undefined, spec: match[2] ?? "" });
    }
    return refs;
}

/** The layer a specifier targets (`../infra/config.ts` -> "infra"), or undefined. */
function targetLayer(spec: string): (typeof LAYERS)[number] | undefined {
    return LAYERS.find((layer) => spec.includes(`/${layer}/`));
}

function scan(
    layer: string,
    forbid: (ref: { typeOnly: boolean; spec: string }) => string | null,
): string[] {
    const failures: string[] = [];
    for (const file of collectSources(join(SRC, layer))) {
        const rel = file.slice(SRC.length);
        for (const ref of moduleRefs(readFileSync(file, "utf8"))) {
            const reason = forbid(ref);
            if (reason) failures.push(`${rel}: ${reason} (import "${ref.spec}")`);
        }
    }
    return failures;
}

describe("layer boundaries", () => {
    it("domain stays pure (no pi runtime, no I/O, no outward imports)", () => {
        expect(
            scan("domain", ({ typeOnly, spec }) => {
                if (PI_RUNTIME.test(spec) && !typeOnly)
                    return "domain must not import the pi runtime";
                if (IO_BUILTIN.test(spec)) return "domain must not do fs/process I/O";
                const layer = targetLayer(spec);
                if (layer && layer !== "domain") return `domain must not import ${layer}`;
                return null;
            }),
        ).toEqual([]);
    });

    it("infra never imports adapters", () => {
        expect(
            scan("infra", ({ spec }) => {
                const layer = targetLayer(spec);
                if (layer === "adapters") return "infra must not import adapters";
                return null;
            }),
        ).toEqual([]);
    });
});
