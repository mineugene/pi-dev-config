import { describe, expect, test } from "vitest";
import { EFFORT_LEVELS, isEffortLevel, parseEffortLevel } from "./effort.ts";

describe("effort levels", () => {
    test("accepts every pi effort level", () => {
        for (const level of EFFORT_LEVELS) {
            expect(isEffortLevel(level)).toBe(true);
            expect(parseEffortLevel(level)).toBe(level);
        }
    });

    test("normalizes direct command input", () => {
        expect(parseEffortLevel("  HIGH  ")).toBe("high");
        expect(parseEffortLevel("xhigh")).toBe("xhigh");
    });

    test("rejects unknown levels", () => {
        expect(parseEffortLevel("ultra")).toBeUndefined();
        expect(parseEffortLevel("high now")).toBeUndefined();
        expect(isEffortLevel(null)).toBe(false);
    });
});
