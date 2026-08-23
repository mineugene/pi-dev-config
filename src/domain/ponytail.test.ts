import { describe, expect, test } from "vitest";

import {
    applyPonytailPromptBlock,
    isPonytailDeactivationPhrase,
    parsePonytailCommand,
    resolvePonytailMode,
} from "./ponytail.ts";

describe("Ponytail domain", () => {
    test("parses modes and status commands", () => {
        expect(parsePonytailCommand(" ultra ")).toEqual({ type: "set-mode", mode: "ultra" });
        expect(parsePonytailCommand("")).toEqual({ type: "status" });
        expect(parsePonytailCommand("status")).toEqual({ type: "status" });
        expect(parsePonytailCommand("fast")).toEqual({ type: "invalid" });
    });

    test("recognises only exact deactivation phrases", () => {
        for (const input of ["stop ponytail", "Stop Ponytail.", "normal mode", "NORMAL MODE!"]) {
            expect(isPonytailDeactivationPhrase(input)).toBe(true);
        }
        for (const input of [
            "how do I stop ponytail?",
            "explain normal mode",
            "don't stop ponytail",
        ]) {
            expect(isPonytailDeactivationPhrase(input)).toBe(false);
        }
    });

    test("uses the newest valid persisted mode", () => {
        expect(resolvePonytailMode([], "full")).toBe("full");
        expect(resolvePonytailMode(["full", "ultra", "off"], "full")).toBe("off");
    });

    test("owns exactly one prompt block without touching unrelated Ponytail text", () => {
        const full = applyPonytailPromptBlock("Ponytail is a horse", "full");
        expect(full).toContain("PONYTAIL MODE ACTIVE: full");
        expect(full.match(/<pi-dev-config-ponytail>/g) ?? []).toHaveLength(1);

        const ultra = applyPonytailPromptBlock(full, "ultra");
        expect(ultra).toContain("PONYTAIL MODE ACTIVE: ultra");
        expect(ultra).not.toContain("PONYTAIL MODE ACTIVE: full");
        expect(ultra.match(/<pi-dev-config-ponytail>/g) ?? []).toHaveLength(1);

        const block = ultra.match(/<pi-dev-config-ponytail>[\s\S]*/)?.[0];
        const duplicated = `${ultra}\n${block}`;
        expect(
            applyPonytailPromptBlock(duplicated, "lite").match(/<pi-dev-config-ponytail>/g) ?? [],
        ).toHaveLength(1);
        expect(applyPonytailPromptBlock(ultra, "off")).toBe("Ponytail is a horse");
        expect(applyPonytailPromptBlock(`before\n\n${block}\n\nafter`, "off")).toBe(
            "before\n\nafter",
        );
    });
});
