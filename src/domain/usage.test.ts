import { describe, expect, it, test } from "vitest";
import {
    decodeSessionUsageEntry,
    type RoutingTaskMetrics,
    summarizeRoutingTasks,
} from "./usage.ts";

const task: RoutingTaskMetrics = {
    taskId: "task-1",
    preset: "general",
    startingRole: "fast",
    highestRole: "base",
    modelsUsed: ["test/fast", "test/base"],
    thinkingLevelsUsed: ["low", "medium"],
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 100,
    estimatedCost: 2,
    assistantFailures: 0,
    infrastructureFailures: 0,
    developmentFailures: 0,
    stagnationEvents: 0,
    correctionCount: 0,
    usedEscalated: false,
    usedDeep: false,
    turns: 2,
    completed: false,
};

describe("routing task usage", () => {
    test.each([
        { entryRisk: "low", entryReasons: [] },
        { entryRisk: "uncertain", entryReasons: ["image-input"] },
        { entryRisk: "high", entryReasons: ["stack-trace", "security"] },
        {},
    ])("round-trips optional entry assessment %j", (assessment) => {
        const data = { ...task, ...assessment };
        expect(
            decodeSessionUsageEntry({ type: "custom", customType: "pidev:routing-task", data }),
        ).toEqual({ type: "routing-task", task: data, timestamp: 0 });
    });

    test.each([
        { entryRisk: "extreme", entryReasons: ["prompt text"] },
        { entryRisk: null, entryReasons: "stack-trace" },
        { entryReasons: ["stack-trace", "unknown"] },
        { entryReasons: Array(33).fill("stack-trace") },
    ])("ignores unknown assessment fields %j", (assessment) => {
        expect(
            decodeSessionUsageEntry({
                type: "custom",
                customType: "pidev:routing-task",
                data: { ...task, ...assessment },
            }),
        ).toEqual({ type: "routing-task", task, timestamp: 0 });
    });
    test.each(["failure", "correction", "follow-up", "limit"])(
        "round-trips handover %s",
        (handover) => {
            const data = { ...task, handover };
            expect(
                decodeSessionUsageEntry({ type: "custom", customType: "pidev:routing-task", data }),
            ).toEqual({ type: "routing-task", task: data, timestamp: 0 });
        },
    );

    test("ignores an unknown handover", () => {
        expect(
            decodeSessionUsageEntry({
                type: "custom",
                customType: "pidev:routing-task",
                data: { ...task, handover: "unknown" },
            }),
        ).toEqual({ type: "routing-task", task, timestamp: 0 });
    });

    test.each(["completed", "superseded", "unresolved", "interrupted"])(
        "round-trips outcome %s",
        (outcome) => {
            const data = { ...task, outcome, completed: outcome === "completed" };
            expect(
                decodeSessionUsageEntry({ type: "custom", customType: "pidev:routing-task", data }),
            ).toEqual({ type: "routing-task", task: data, timestamp: 0 });
        },
    );

    test("ignores an unknown outcome without losing the legacy completion flag", () => {
        expect(
            decodeSessionUsageEntry({
                type: "custom",
                customType: "pidev:routing-task",
                data: { ...task, outcome: "unknown", completed: true },
            }),
        ).toEqual({ type: "routing-task", task: { ...task, completed: true }, timestamp: 0 });
    });

    test("counts success, outcomes, entry risk, and cost per successful task", () => {
        const tasks: RoutingTaskMetrics[] = [
            {
                ...task,
                taskId: "low-completed",
                entryRisk: "low",
                outcome: "completed",
                completed: true,
                estimatedCost: 2,
                highestRole: "fast",
            },
            {
                ...task,
                taskId: "low-superseded",
                entryRisk: "low",
                outcome: "superseded",
                estimatedCost: 4,
                handover: "correction",
                usedEscalated: true,
                usedDeep: true,
            },
            {
                ...task,
                taskId: "high-unresolved",
                entryRisk: "high",
                outcome: "unresolved",
                estimatedCost: 3,
                startingRole: "base",
            },
            {
                ...task,
                taskId: "uncertain-interrupted",
                entryRisk: "uncertain",
                outcome: "interrupted",
                estimatedCost: 1,
                startingRole: "base",
            },
            { ...task, taskId: "old-completed", completed: true, estimatedCost: 5 },
            { ...task, taskId: "old-incomplete", entryRisk: "low", estimatedCost: 7 },
        ];
        const summary = summarizeRoutingTasks(
            tasks.map((task) => ({
                timestamp: 1,
                task: {
                    ...task,
                    modelUsage: [
                        {
                            model: "test/base",
                            estimatedCost: task.estimatedCost ?? 0,
                            inputTokens: 100,
                            outputTokens: 50,
                            cachedInputTokens: 100,
                            reasoningTokens: 0,
                        },
                    ],
                },
            })),
        );
        expect(summary).toMatchObject({
            tasks: 6,
            successful: 3,
            completed: 2,
            estimatedCost: 22,
            outcomes: { completed: 2, superseded: 1, unresolved: 1, interrupted: 1 },
            risks: [
                {
                    risk: "low",
                    tasks: 2,
                    successful: 2,
                    handovers: 1,
                    recoveries: 1,
                    costPerSuccess: 3,
                    inputTokens: 200,
                    cachedInputTokens: 200,
                },
                {
                    risk: "uncertain",
                    tasks: 1,
                    successful: 0,
                    handovers: 0,
                    recoveries: 0,
                    costPerSuccess: 0,
                },
                {
                    risk: "high",
                    tasks: 1,
                    successful: 0,
                    handovers: 0,
                    recoveries: 0,
                    costPerSuccess: 0,
                },
                { risk: "unassessed", tasks: 2, successful: 1, costPerSuccess: 12 },
            ],
        });
        expect(summary.costPerSuccess).toBeCloseTo(7.333333);
        expect(summary.models[0]).toMatchObject({ tasks: 6, successful: 3, completed: 2 });
        expect(summary.models[0]?.costPerSuccess).toBeCloseTo(7.333333);
    });

    test("does not count manual role changes as new-record handovers", () => {
        const summary = summarizeRoutingTasks([
            {
                timestamp: 1,
                task: {
                    ...task,
                    outcome: "superseded",
                    entryRisk: "low",
                },
            },
        ]);
        expect(summary.fastToBase).toBe(0);
    });

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
