import { describe, expect, it } from "vitest";

import { pickWorkingVerb, WORKING_VERBS } from "./working-verbs.ts";

describe("working verbs", () => {
    it("holds exactly 200 unique verbs", () => {
        expect(WORKING_VERBS).toHaveLength(200);
        expect(new Set(WORKING_VERBS).size).toBe(200);
    });

    it("keeps every verb short, trimmed, and single-line", () => {
        for (const verb of WORKING_VERBS) {
            expect(verb.length).toBeLessThanOrEqual(24);
            expect(verb).toBe(verb.trim());
            expect(verb).not.toMatch(/[\n\r]/);
        }
    });

    it("picks deterministically from a seeded rng", () => {
        expect(pickWorkingVerb(WORKING_VERBS, () => 0)).toBe(WORKING_VERBS[0]);
        expect(pickWorkingVerb(WORKING_VERBS, () => 0.999_999)).toBe(
            WORKING_VERBS[WORKING_VERBS.length - 1],
        );
        expect(pickWorkingVerb(WORKING_VERBS, () => 0.5)).toBe(WORKING_VERBS[100]);
    });

    it("returns undefined for an empty list", () => {
        expect(pickWorkingVerb([])).toBeUndefined();
    });

    it("always returns a member of the list", () => {
        const single = pickWorkingVerb(["Brewing"], () => 0.9);
        expect(single).toBe("Brewing");
    });
});
