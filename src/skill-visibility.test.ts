import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../skills/", import.meta.url));
const MANUAL_ONLY = [
    "grill-me",
    "handoff",
    "implement",
    "implement-spec",
    "improve-codebase-architecture",
    "ponytail-audit",
    "ponytail-debt",
    "ponytail-gain",
    "ponytail-help",
    "ponytail-review",
    "quick-commit",
    "to-pr",
    "to-spec",
    "to-tickets",
    "wait-what",
] as const;

const MODEL_INVOKED = [
    "codebase-design",
    "domain-modeling",
    "grill-with-docs",
    "pr",
    "spec",
    "tickets",
    "writing-for-agents",
] as const;

describe("skill visibility", () => {
    it("keeps explicit workflow utilities out of the baseline catalogue", () => {
        for (const name of MANUAL_ONLY) {
            const source = readFileSync(`${ROOT}${name}/SKILL.md`, "utf8");
            expect(source, name).toMatch(/^---[\s\S]*?^disable-model-invocation: true$/m);
        }
    });

    it("exposes automatic feature discovery skills to the model", () => {
        for (const name of MODEL_INVOKED) {
            const source = readFileSync(`${ROOT}${name}/SKILL.md`, "utf8");
            expect(source, name).not.toMatch(/^---[\s\S]*?^disable-model-invocation: true$/m);
        }
    });
});
