import { describe, expect, test } from "vitest";
import {
    buildRoutingRecoveryLadder,
    classifyRoutingFailure,
    classifyRoutingUserSignal,
    initialRoutingState,
    modelKey,
    normalizeFailureThreshold,
    recordRoutingCorrection,
    recordRoutingFailure,
    recordRoutingOutcome,
    routingFailureSignature,
    routingTargetKey,
    routingTaskComplexity,
    routingTaskNeedsBase,
} from "./routing.ts";

describe("routing target identity", () => {
    test("builds the configured recovery ladder and collapses only adjacent duplicates", () => {
        const base = { model: { provider: "test", id: "base" }, thinkingLevel: "medium" };
        const escalated = { model: { provider: "test", id: "escalated" } };
        const deep = { ...base };

        expect(buildRoutingRecoveryLadder(base, undefined, deep).map(({ role }) => role)).toEqual([
            "base",
        ]);
        expect(buildRoutingRecoveryLadder(base, escalated, deep).map(({ role }) => role)).toEqual([
            "base",
            "escalated",
            "deep",
        ]);
    });

    test("distinguishes routes by thinking level while retaining model identity", () => {
        const low = { model: { provider: "OpenAI", id: "GPT-5" }, thinkingLevel: "low" };
        const high = { model: { provider: "openai", id: "gpt-5" }, thinkingLevel: "high" };

        expect(modelKey(low.model)).toBe("openai/gpt-5");
        expect(modelKey(low.model)).toBe(modelKey(high.model));
        expect(routingTargetKey(low)).toBe("openai/gpt-5:low");
        expect(routingTargetKey(high)).toBe("openai/gpt-5:high");
    });

    test("treats omitted thinking level as the effective default", () => {
        expect(routingTargetKey({ model: { provider: "test", id: "base" } })).toBe(
            "test/base:default",
        );
    });
});

describe("routing failure classification", () => {
    test("does not treat a grep no-match as model failure", () => {
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "stop" },
                toolResults: [
                    { toolName: "grep", isError: true, output: "No matches found for: legacyFlag" },
                ],
            }),
        ).toMatchObject({ kind: "none" });
    });

    test("separates development and infrastructure failures from assistant failures", () => {
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "stop" },
                toolResults: [
                    {
                        toolName: "bash",
                        isError: true,
                        output: "src/auth.ts(12,4): error TS2322: Type 'string' is not assignable",
                    },
                ],
            }),
        ).toMatchObject({ kind: "development", signature: "tsc:TS2322:src/auth.ts" });
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "stop" },
                toolResults: [{ toolName: "bash", isError: true, output: "ETIMEDOUT" }],
            }),
        ).toMatchObject({ kind: "tool-infrastructure" });
        expect(
            classifyRoutingFailure({ assistant: { stopReason: "error" }, toolResults: [] }),
        ).toMatchObject({ kind: "assistant" });
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "error", errorMessage: "context length exceeded" },
                toolResults: [],
            }),
        ).toMatchObject({ kind: "context-limit" });
    });

    test("recognizes context exhaustion reported by a tool", () => {
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "error" },
                toolResults: [
                    {
                        toolName: "bash",
                        isError: true,
                        output: "request failed: maximum context length exceeded",
                    },
                ],
            }),
        ).toMatchObject({ kind: "context-limit", kinds: ["assistant", "context-limit"] });
    });

    test("normalizes volatile compiler locations into stable signatures", () => {
        expect(
            routingFailureSignature(
                "bash",
                "/work/src/foo.ts:84:12 - error TS2322: Type 'x' is not assignable",
            ),
        ).toBe("tsc:TS2322:src/foo.ts");
    });

    test("bounds a signature even when tool output has an unusually long path", () => {
        const signature = routingFailureSignature(
            "bash",
            `src/${"a".repeat(300)}.ts:1:1 error TS2322`,
        );
        expect(signature?.length).toBeLessThanOrEqual(160);
    });

    test("normalizes a Vitest-style failing test", () => {
        expect(
            classifyRoutingFailure({
                assistant: { stopReason: "stop" },
                toolResults: [
                    {
                        toolName: "bash",
                        isError: true,
                        output: "FAIL src/auth.test.ts\nAssertionError: expected true to be false",
                    },
                ],
            }),
        ).toMatchObject({ kind: "development", signature: "test:src/auth.test.ts:AssertionError" });
    });
});

describe("routing outcomes", () => {
    test("keeps fast out of the recovery ladder", () => {
        const failedFast = recordRoutingOutcome(initialRoutingState(), "fast", true, 2, 3);

        expect(failedFast).toEqual({ ...initialRoutingState(), forceBase: true });
    });

    test("resets failure budgets at each explicit recovery rung", () => {
        const firstBaseFailure = recordRoutingOutcome(initialRoutingState(), "base", true, 2, 3);
        expect(firstBaseFailure).toMatchObject({ recoveryIndex: 0, consecutiveFailures: 1 });

        const escalated = recordRoutingOutcome(firstBaseFailure, "base", true, 2, 3);
        expect(escalated).toMatchObject({
            recoveryIndex: 1,
            consecutiveFailures: 0,
            correctionCount: 0,
        });

        const firstEscalatedFailure = recordRoutingOutcome(escalated, "escalated", true, 2, 3);
        expect(firstEscalatedFailure).toMatchObject({ recoveryIndex: 1, consecutiveFailures: 1 });

        expect(recordRoutingOutcome(firstEscalatedFailure, "escalated", true, 2, 3)).toMatchObject({
            recoveryIndex: 2,
            consecutiveFailures: 0,
        });
    });

    test("skips the missing escalated rung and remains on the final route", () => {
        const first = recordRoutingOutcome(initialRoutingState(), "base", true, 2, 2);
        const deep = recordRoutingOutcome(first, "base", true, 2, 2);
        const exhausted = recordRoutingOutcome(deep, "deep", true, 2, 2);

        expect(deep).toMatchObject({ recoveryIndex: 1, consecutiveFailures: 0 });
        expect(exhausted).toEqual(deep);
    });

    test("remains on base or escalated when no stronger target exists", () => {
        expect(recordRoutingOutcome(initialRoutingState(), "base", true, 1, 1)).toMatchObject({
            recoveryIndex: 0,
            consecutiveFailures: 1,
        });
        expect(
            recordRoutingOutcome(
                { ...initialRoutingState(), recoveryIndex: 1 },
                "escalated",
                true,
                1,
                2,
            ),
        ).toMatchObject({ recoveryIndex: 1, consecutiveFailures: 1 });
    });

    test("resets a recovery-rung failure counter after success", () => {
        const failed = {
            ...initialRoutingState(),
            recoveryIndex: 1,
            consecutiveFailures: 1,
        };

        expect(recordRoutingOutcome(failed, "escalated", false, 2, 3)).toMatchObject({
            recoveryIndex: 1,
            consecutiveFailures: 0,
        });
    });

    test("resets correction budgets after advancing and never skips base from fast", () => {
        const fastCorrection = recordRoutingCorrection(initialRoutingState(), 1, 3, "fast");
        expect(fastCorrection).toEqual({ ...initialRoutingState(), forceBase: true });

        const firstBaseCorrection = recordRoutingCorrection(initialRoutingState(), 2, 3, "base");
        const escalated = recordRoutingCorrection(firstBaseCorrection, 2, 3, "base");
        expect(escalated).toMatchObject({ recoveryIndex: 1, correctionCount: 0 });

        const firstEscalatedCorrection = recordRoutingCorrection(escalated, 2, 3, "escalated");
        expect(firstEscalatedCorrection).toMatchObject({ recoveryIndex: 1, correctionCount: 1 });
        expect(recordRoutingCorrection(firstEscalatedCorrection, 2, 3, "escalated")).toMatchObject({
            recoveryIndex: 2,
            correctionCount: 0,
        });
    });

    test("uses two as the default valid threshold", () => {
        expect(normalizeFailureThreshold(undefined)).toBe(2);
        expect(normalizeFailureThreshold(0)).toBe(2);
        expect(normalizeFailureThreshold(2.5)).toBe(2);
        expect(normalizeFailureThreshold(3)).toBe(3);
    });
});

describe("routing stagnation", () => {
    const escalation = {
        failureThreshold: 2,
        stagnationThreshold: 2,
        recoveryTargetCount: 3,
    };
    const failure = {
        kind: "development" as const,
        signature: "tsc:TS2322:src/auth.ts",
        kinds: ["development"] as const,
    };

    const afterRemediation = (state: ReturnType<typeof initialRoutingState>) =>
        recordRoutingFailure(
            state,
            "base",
            { kind: "none", kinds: [] },
            { ...escalation, attemptedRemediation: true },
        );

    test("counts a matching development failure only after remediation", () => {
        const first = recordRoutingFailure(initialRoutingState(), "base", failure, escalation);
        const repeated = recordRoutingFailure(afterRemediation(first), "base", failure, escalation);

        expect(first).toMatchObject({ recoveryIndex: 0, consecutiveFailures: 0 });
        expect(repeated).toMatchObject({
            recoveryIndex: 0,
            consecutiveFailures: 1,
            stagnationEvents: 1,
        });
    });

    test("advances through explicit recovery rungs after continued stagnation", () => {
        const first = recordRoutingFailure(initialRoutingState(), "base", failure, escalation);
        const second = recordRoutingFailure(afterRemediation(first), "base", failure, escalation);
        const escalated = recordRoutingFailure(
            afterRemediation(second),
            "base",
            failure,
            escalation,
        );
        const third = recordRoutingFailure(
            afterRemediation(escalated),
            "escalated",
            failure,
            escalation,
        );
        const deep = recordRoutingFailure(
            afterRemediation(third),
            "escalated",
            failure,
            escalation,
        );

        expect(escalated).toMatchObject({ recoveryIndex: 1, consecutiveFailures: 0 });
        expect(deep).toMatchObject({ recoveryIndex: 2, consecutiveFailures: 0 });
    });

    test("resets failure tracking when the material error changes", () => {
        const first = recordRoutingFailure(initialRoutingState(), "base", failure, escalation);
        const changed = recordRoutingFailure(
            first,
            "base",
            { kind: "development", signature: "tsc:TS2345:src/auth.ts", kinds: ["development"] },
            escalation,
        );

        expect(changed).toMatchObject({
            recoveryIndex: 0,
            failureSignature: {
                signature: "tsc:TS2345:src/auth.ts",
                occurrences: 1,
                attemptsSinceChange: 0,
            },
        });
    });

    test("clears active failure tracking after a successful escalated turn", () => {
        const state = {
            ...initialRoutingState(),
            recoveryIndex: 1,
            consecutiveFailures: 1,
            failureSignature: {
                signature: "test:login:AssertionError",
                occurrences: 2,
                attemptsSinceChange: 1,
            },
            stagnationEvents: 1,
        };
        const recovered = recordRoutingFailure(
            state,
            "escalated",
            { kind: "none", kinds: [] },
            { ...escalation, developmentSucceeded: true },
        );

        expect(recovered).toMatchObject({ recoveryIndex: 1, consecutiveFailures: 0 });
        expect(recovered.failureSignature).toEqual({ occurrences: 0, attemptsSinceChange: 0 });
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

describe("routing complexity scoring", () => {
    test.each([
        [
            "Fix this error:\nTypeError: Cannot read properties of undefined\n    at run (src/app.ts:42:5)\n```ts\nconst value = input.user.name;\n```",
            "stack trace",
        ],
        [
            "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,4 @@\n-old\n+new\n+more",
            "patch",
        ],
        ["FAIL src/auth.test.ts", "test output"],
        ["Compare src/auth.ts, src/session.ts, and src/token.ts", "multiple files"],
        ["Explain linearizable distributed transactions", "architecture"],
    ])("scores %s as a base task", (text, reason) => {
        const complexity = routingTaskComplexity(text);
        expect(complexity.score).toBeGreaterThanOrEqual(2);
        expect(complexity.reason).toBe(reason);
        expect(routingTaskNeedsBase(text)).toBe(true);
    });

    test("does not over-route a one-line code snippet", () => {
        expect(routingTaskComplexity("```ts\nconst x = 1;\n```").score).toBeLessThan(2);
    });
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
