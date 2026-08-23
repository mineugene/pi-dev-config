import { describe, expect, test } from "vitest";

import { type AutoCompactState, decideCompaction } from "./auto-compact.ts";

const CLAUDE = 200_000;
const COPILOT = 900_000;

function state(overrides: Partial<AutoCompactState> = {}): AutoCompactState {
    return {
        tokens: 0,
        contextWindow: CLAUDE,
        todosOpen: false,
        turnsSinceCompaction: null,
        ...overrides,
    };
}

describe("decideCompaction", () => {
    test("holds when the context size is unknown", () => {
        expect(decideCompaction(state({ tokens: null }))).toEqual({
            compact: false,
            reason: "unknown",
        });
        expect(decideCompaction(state({ tokens: 190_000, contextWindow: 0 }))).toEqual({
            compact: false,
            reason: "unknown",
        });
    });

    test("holds below the absolute floor even on a tiny window", () => {
        expect(decideCompaction(state({ tokens: 39_999, contextWindow: 32_000 }))).toEqual({
            compact: false,
            reason: "below-floor",
        });
    });

    test("holds between the floor and the soft band", () => {
        expect(decideCompaction(state({ tokens: 100_000 }))).toEqual({
            compact: false,
            reason: "below-floor",
        });
    });

    test("compacts in the soft band at a task boundary", () => {
        // 70% of 200k = 140k, below the 180k ceiling.
        expect(decideCompaction(state({ tokens: 140_000 }))).toEqual({
            compact: true,
            band: "soft",
        });
    });

    test("holds in the soft band while a plan is open", () => {
        expect(decideCompaction(state({ tokens: 140_000, todosOpen: true }))).toEqual({
            compact: false,
            reason: "mid-task",
        });
    });

    test("compacts in the hard band despite an open plan", () => {
        // 85% of 200k = 170k, below the 220k ceiling.
        expect(decideCompaction(state({ tokens: 170_000, todosOpen: true }))).toEqual({
            compact: true,
            band: "hard",
        });
    });

    test("uses the absolute ceiling on a very large window", () => {
        // 70% of 900k would be 630k; the 180k ceiling binds instead.
        expect(decideCompaction(state({ tokens: 180_000, contextWindow: COPILOT }))).toEqual({
            compact: true,
            band: "soft",
        });
        expect(decideCompaction(state({ tokens: 179_999, contextWindow: COPILOT }))).toEqual({
            compact: false,
            reason: "below-floor",
        });
        expect(
            decideCompaction(state({ tokens: 220_000, contextWindow: COPILOT, todosOpen: true })),
        ).toEqual({ compact: true, band: "hard" });
    });

    test("waits out the cooldown after a compaction", () => {
        expect(decideCompaction(state({ tokens: 190_000, turnsSinceCompaction: 1 }))).toEqual({
            compact: false,
            reason: "cooldown",
        });
        expect(decideCompaction(state({ tokens: 190_000, turnsSinceCompaction: 2 }))).toEqual({
            compact: true,
            band: "hard",
        });
    });

    test("is off when disabled", () => {
        expect(decideCompaction(state({ tokens: 190_000 }), { enabled: false })).toEqual({
            compact: false,
            reason: "disabled",
        });
    });

    test("honours configured overrides", () => {
        const overrides = { softPercent: 0.5, softCeilingTokens: 1_000_000, minTokens: 10_000 };
        expect(decideCompaction(state({ tokens: 100_000 }), overrides)).toEqual({
            compact: true,
            band: "soft",
        });
    });
});
