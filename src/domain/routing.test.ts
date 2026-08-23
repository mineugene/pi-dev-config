import { describe, expect, test } from "vitest";
import {
    classifyRoutingUserSignal,
    initialRoutingState,
    normalizeFailureThreshold,
    recordRoutingCorrection,
    recordRoutingOutcome,
    routingTaskNeedsBase,
} from "./routing.ts";

describe("routing outcomes", () => {
    test("keeps the strict fast to base to deep failure ladder", () => {
        const initial = initialRoutingState();
        const afterFastFailure = recordRoutingOutcome(initial, "fast", true, 2, true);
        expect(afterFastFailure).toEqual({ ...initial, forceBase: true });

        const afterFirstBaseFailure = recordRoutingOutcome(afterFastFailure, "base", true, 2, true);
        expect(afterFirstBaseFailure).toEqual({
            ...initial,
            consecutiveBaseFailures: 1,
            forceBase: true,
        });

        expect(recordRoutingOutcome(afterFirstBaseFailure, "base", true, 2, true)).toEqual({
            ...initial,
            phase: "ESCALATED",
            consecutiveBaseFailures: 2,
        });
    });

    test("does not escalate without a deep model and resets after base success", () => {
        const failed = recordRoutingOutcome(initialRoutingState(), "base", true, 1, false);
        expect(failed.phase).toBe("NORMAL");
        expect(recordRoutingOutcome(failed, "base", false, 1, false)).toEqual(
            initialRoutingState(),
        );
    });

    test("keeps correction count across successful turns and escalates independently", () => {
        const corrected = recordRoutingCorrection(initialRoutingState(), 2, true);
        expect(corrected).toEqual({
            ...initialRoutingState(),
            correctionCount: 1,
            forceBase: true,
        });

        const successfulRetry = recordRoutingOutcome(corrected, "base", false, 2, true);
        expect(successfulRetry.correctionCount).toBe(1);
        expect(recordRoutingCorrection(successfulRetry, 2, true)).toEqual({
            ...initialRoutingState(),
            phase: "ESCALATED",
            correctionCount: 2,
        });
    });

    test("uses two as the default valid threshold", () => {
        expect(normalizeFailureThreshold(undefined)).toBe(2);
        expect(normalizeFailureThreshold(0)).toBe(2);
        expect(normalizeFailureThreshold(2.5)).toBe(2);
        expect(normalizeFailureThreshold(3)).toBe(3);
    });
});

describe("routing task complexity", () => {
    test.each([
        "Debug the failing integration",
        "Review and refactor the authentication flow",
        "Handle this multi-step task",
        "Update several modules",
        "Rename the value, then run the tests",
        "Update the parser\nRun the tests",
        "1. Inspect the parser\n2. Fix every caller",
        "/skill:review src/index.ts",
    ])("routes %j to base", (text) => {
        expect(routingTaskNeedsBase(text)).toBe(true);
    });

    test.each(["Format this file", "Rename one local variable", "Explain this constant"])(
        "allows a fast first pass for %j",
        (text) => {
            expect(routingTaskNeedsBase(text)).toBe(false);
        },
    );
});

describe("routing user signals", () => {
    test.each([
        ["that's wrong, try again", "negative"],
        ["This is wrong", "negative"],
        ["No, please use the existing helper", "negative"],
        ["The test still fails", "negative"],
        ["Retry that", "negative"],
        ["That was not exactly right", "negative"],
        ["You overlooked the error handling", "negative"],
        ["Please fix that", "negative"],
        ["looks good", "complete"],
        ["and update the test", "continuation"],
        ["Please handle the remaining test", "continuation"],
        ["Add OAuth login", "new-task"],
    ] as const)("classifies %j as %s", (text, expected) => {
        expect(classifyRoutingUserSignal(text)).toBe(expected);
    });
});
