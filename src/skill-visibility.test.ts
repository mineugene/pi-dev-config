import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../skills/", import.meta.url));
const MANUAL_ONLY = [
    "grill-me",
    "handoff",
    "ponytail-audit",
    "ponytail-debt",
    "ponytail-gain",
    "ponytail-help",
    "ponytail-review",
    "quick-commit",
    "to-spec",
] as const;

describe("skill visibility", () => {
    it("keeps explicit workflow utilities out of the baseline catalogue", () => {
        for (const name of MANUAL_ONLY) {
            const source = readFileSync(`${ROOT}${name}/SKILL.md`, "utf8");
            expect(source, name).toMatch(/^---[\s\S]*?^disable-model-invocation: true$/m);
        }
    });
});
