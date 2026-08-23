import { describe, expect, it } from "vitest";

import { formatDuration } from "./duration.ts";

describe("formatDuration", () => {
    it.each([
        [0, "0ms"],
        [862, "862ms"],
        [999.9, "999ms"],
        [1_000, "1s"],
        [59_999, "59s"],
        [89_000, "1m 29s"],
        [3_661_000, "1h 1m 1s"],
    ])("formats %dms as %s", (milliseconds, expected) => {
        expect(formatDuration(milliseconds)).toBe(expected);
    });

    it("clamps invalid and negative durations", () => {
        expect(formatDuration(-1)).toBe("0ms");
        expect(formatDuration(Number.NaN)).toBe("0ms");
    });
});
