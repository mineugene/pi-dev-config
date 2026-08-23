import { describe, expect, it, test } from "vitest";
import { decodeSessionUsageEntry, summarizeRoutingTasks } from "./usage.ts";

describe("routing task usage", () => {
    test("decodes the explicit escalated role and summarizes recovery routes", () => {
        const decoded = decodeSessionUsageEntry({
            type: "custom",
            customType: "pidev:routing-task",
            data: {
                taskId: "task-escalated",
                preset: "general",
                startingRole: "base",
                highestRole: "escalated",
                modelsUsed: ["test/base", "test/escalated"],
                thinkingLevelsUsed: ["medium", "max"],
                inputTokens: 100,
                outputTokens: 50,
                assistantFailures: 2,
                infrastructureFailures: 0,
                developmentFailures: 0,
                stagnationEvents: 0,
                correctionCount: 0,
                usedEscalated: true,
                usedDeep: false,
                turns: 3,
                completed: true,
            },
        });

        expect(decoded).toMatchObject({
            type: "routing-task",
            task: {
                highestRole: "escalated",
                usedEscalated: true,
                usedDeep: false,
            },
        });
        if (decoded?.type !== "routing-task") throw new Error("routing task did not decode");
        expect(summarizeRoutingTasks([decoded])).toMatchObject({
            escalatedRecoveries: 1,
            deepRecoveries: 0,
        });
    });

    test("decodes legacy recovery flags and summarizes success and cost", () => {
        const decoded = decodeSessionUsageEntry({
            type: "custom",
            customType: "pidev:routing-task",
            timestamp: "2026-01-02T03:04:05.000Z",
            data: {
                taskId: "task-1",
                preset: "general",
                startingRole: "fast",
                highestRole: "deep",
                modelsUsed: ["test/fast", "test/base", "test/deep"],
                thinkingLevelsUsed: ["low", "medium", "max"],
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 20,
                estimatedCost: 0.25,
                assistantFailures: 1,
                infrastructureFailures: 0,
                developmentFailures: 2,
                stagnationEvents: 1,
                correctionCount: 1,
                escalatedReasoning: true,
                escalatedDeep: true,
                turns: 3,
                completed: true,
            },
        });

        expect(decoded).toMatchObject({ type: "routing-task", timestamp: 1_767_323_045_000 });
        if (decoded?.type !== "routing-task") throw new Error("routing task did not decode");
        expect(summarizeRoutingTasks([decoded])).toMatchObject({
            tasks: 1,
            completed: 1,
            startedFast: 1,
            fastToBase: 1,
            escalatedRecoveries: 1,
            deepRecoveries: 1,
            inputTokens: 100,
            outputTokens: 50,
            cachedInputTokens: 20,
            estimatedCost: 0.25,
            costPerSuccess: 0.25,
            corrections: 1,
            stagnationEvents: 1,
            assistantFailures: 1,
            infrastructureFailures: 0,
            developmentFailures: 2,
        });
    });

    test("does not report a manual fast-to-deep jump as fast to base", () => {
        const summary = summarizeRoutingTasks([
            {
                timestamp: 1,
                task: {
                    taskId: "manual-deep",
                    preset: "general",
                    startingRole: "fast",
                    highestRole: "deep",
                    modelsUsed: ["test/fast", "test/deep"],
                    thinkingLevelsUsed: ["low", "max"],
                    inputTokens: 10,
                    outputTokens: 5,
                    assistantFailures: 0,
                    infrastructureFailures: 0,
                    developmentFailures: 0,
                    stagnationEvents: 0,
                    correctionCount: 0,
                    usedEscalated: false,
                    usedDeep: false,
                    turns: 1,
                    completed: true,
                },
            },
        ]);

        expect(summary.fastToBase).toBe(0);
    });

    test("deduplicates forked task records by task ID", () => {
        const task = {
            timestamp: 1,
            task: {
                taskId: "shared-task",
                preset: "general",
                startingRole: "base" as const,
                highestRole: "base" as const,
                modelsUsed: ["test/base"],
                thinkingLevelsUsed: ["medium"],
                inputTokens: 10,
                outputTokens: 5,
                assistantFailures: 0,
                infrastructureFailures: 0,
                developmentFailures: 0,
                stagnationEvents: 0,
                correctionCount: 0,
                usedEscalated: false,
                usedDeep: false,
                turns: 1,
                completed: true,
            },
        };

        expect(summarizeRoutingTasks([task, { ...task, timestamp: 2 }]).tasks).toBe(1);
    });

    test("rejects malformed routing telemetry", () => {
        expect(
            decodeSessionUsageEntry({
                type: "custom",
                customType: "pidev:routing-task",
                data: { taskId: "task-1", modelsUsed: ["raw prompt must not be accepted"] },
            }),
        ).toBeUndefined();
    });
});

describe("decodeSessionUsageEntry", () => {
    it("decodes assistant usage with the session-entry timestamp fallback", () => {
        expect(
            decodeSessionUsageEntry({
                type: "message",
                timestamp: "2026-01-02T03:04:05.000Z",
                message: {
                    role: "assistant",
                    provider: "anthropic",
                    model: "claude",
                    usage: {
                        input: 10,
                        output: 20,
                        cacheRead: 30,
                        cacheWrite: 40,
                        cost: { total: 0.5 },
                    },
                },
            }),
        ).toEqual({
            type: "message",
            message: {
                provider: "anthropic",
                model: "claude",
                cost: 0.5,
                input: 10,
                output: 20,
                cacheRead: 30,
                cacheWrite: 40,
                timestamp: 1_767_323_045_000,
            },
        });
    });

    it("rejects malformed entries and normalizes partial or non-finite usage", () => {
        expect(decodeSessionUsageEntry({ type: "session", id: "session-1" })).toEqual({
            type: "session",
            sessionId: "session-1",
        });
        expect(
            decodeSessionUsageEntry({ type: "message", message: { role: "assistant" } }),
        ).toBeUndefined();
        expect(decodeSessionUsageEntry(null)).toBeUndefined();

        expect(
            decodeSessionUsageEntry({
                type: "message",
                message: {
                    role: "assistant",
                    provider: "anthropic",
                    model: "claude",
                    timestamp: JSON.parse("1e400"),
                    usage: { input: JSON.parse("1e400") },
                },
            }),
        ).toEqual({
            type: "message",
            message: {
                provider: "anthropic",
                model: "claude",
                cost: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                timestamp: 0,
            },
        });
    });
});
