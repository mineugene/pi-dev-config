import { describe, expect, test } from "vitest";

import type { RoutingTaskMetrics } from "../domain/usage.ts";
import { formatRoutingSummary } from "./usage-dashboard.ts";

describe("formatRoutingSummary", () => {
    test("shows outcomes and the entry-risk table using successful tasks", () => {
        const base: RoutingTaskMetrics = {
            taskId: "task",
            preset: "general",
            startingRole: "base",
            highestRole: "base",
            modelsUsed: ["test/base"],
            thinkingLevelsUsed: ["medium"],
            inputTokens: 100,
            outputTokens: 50,
            cachedInputTokens: 100,
            assistantFailures: 0,
            infrastructureFailures: 0,
            developmentFailures: 0,
            stagnationEvents: 0,
            correctionCount: 0,
            usedEscalated: false,
            usedDeep: false,
            turns: 1,
            completed: false,
        };
        const tasks: RoutingTaskMetrics[] = [
            {
                ...base,
                taskId: "low-1",
                entryRisk: "low",
                outcome: "completed",
                completed: true,
                estimatedCost: 0.5,
            },
            {
                ...base,
                taskId: "low-2",
                entryRisk: "low",
                outcome: "superseded",
                handover: "limit",
                usedEscalated: true,
                usedDeep: true,
                estimatedCost: 1.5,
            },
            {
                ...base,
                taskId: "uncertain",
                entryRisk: "uncertain",
                outcome: "unresolved",
                estimatedCost: 1,
            },
            {
                ...base,
                taskId: "high",
                entryRisk: "high",
                outcome: "interrupted",
                estimatedCost: 1,
            },
            { ...base, taskId: "legacy", completed: true, estimatedCost: 1 },
        ];
        const lines = formatRoutingSummary(
            tasks.map((task) => ({
                timestamp: 1,
                task: {
                    ...task,
                    modelUsage: [
                        {
                            model: "test/base",
                            inputTokens: 100,
                            outputTokens: 50,
                            reasoningTokens: 0,
                            cachedInputTokens: 100,
                            estimatedCost: task.estimatedCost ?? 0,
                        },
                    ],
                },
            })),
        );
        const text = lines.join("\n");
        expect(text).toContain(
            "Successful                 3 (60.0%)\nCompleted                  2 (40.0%)",
        );
        expect(text).toContain("Superseded                 1");
        expect(text).toContain("Unresolved                 1");
        expect(text).toContain("Interrupted                1");
        expect(text).toContain("Mean cost/success          $1.67");
        expect(text).toContain("Entry risk");
        expect(text).toContain("Handover");
        expect(text).toContain("Cached input");
        expect(
            lines
                .filter((line) => /^(low|uncertain|high|unassessed)\s/.test(line))
                .map((line) => line.trim().split(/\s+/)),
        ).toEqual([
            ["low", "2", "100.0%", "50.0%", "50.0%", "$1.00", "50.0%"],
            ["uncertain", "1", "0.0%", "0.0%", "0.0%", "-", "50.0%"],
            ["high", "1", "0.0%", "0.0%", "0.0%", "-", "50.0%"],
            ["unassessed", "1", "100.0%", "0.0%", "0.0%", "$1.00", "50.0%"],
        ]);
        expect(
            lines
                .find((line) => line.startsWith("test/base"))
                ?.trim()
                .split(/\s+/),
        ).toEqual(["test/base", "5", "60.0%", "$1.67"]);
    });

    test("handles an empty routing history", () => {
        expect(formatRoutingSummary([])).toEqual(["Routing: no task metrics recorded yet."]);
    });
    test("shows completed-task routing, escalation, and cost metrics without task content", () => {
        const lines = formatRoutingSummary([
            {
                timestamp: 1,
                task: {
                    taskId: "task-1",
                    preset: "general",
                    startingRole: "fast",
                    highestRole: "deep",
                    modelsUsed: ["test/fast", "test/base", "test/deep"],
                    thinkingLevelsUsed: ["low", "medium", "max"],
                    modelUsage: [
                        {
                            model: "test/deep",
                            inputTokens: 1_000,
                            outputTokens: 250,
                            reasoningTokens: 0,
                            cachedInputTokens: 100,
                            estimatedCost: 0.5,
                        },
                    ],
                    inputTokens: 1_000,
                    outputTokens: 250,
                    cachedInputTokens: 100,
                    estimatedCost: 0.5,
                    assistantFailures: 1,
                    infrastructureFailures: 0,
                    developmentFailures: 2,
                    stagnationEvents: 1,
                    correctionCount: 1,
                    usedEscalated: true,
                    usedDeep: true,
                    turns: 3,
                    completed: true,
                },
            },
        ]);

        expect(lines.join("\n")).toContain("Routing: last 1 task");
        expect(lines.join("\n")).toContain("Successful                 1 (100.0%)");
        expect(lines.join("\n")).toContain("Completed                  1 (100.0%)");
        expect(lines.join("\n")).toContain("Superseded                 0");
        expect(lines.join("\n")).toContain("Unresolved                 0");
        expect(lines.join("\n")).toContain("Interrupted                0");
        expect(lines.join("\n")).toContain("unassessed");
        expect(lines.join("\n")).toContain("Fast to base               1 (100.0%)");
        expect(lines.join("\n")).toContain("Escalated recovery         1 (100.0%)");
        expect(lines.join("\n")).toContain("Deep recovery              1 (100.0%)");
        expect(lines.join("\n")).toContain("Mean cost/success          $0.50");
        expect(lines.join("\n")).toContain("test/deep");
        expect(lines.join("\n")).toContain("$0.50");
        expect(lines.join("\n")).not.toContain("task-1");
    });
});
