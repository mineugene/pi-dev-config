import { describe, expect, test } from "vitest";

import { formatRoutingSummary } from "./usage-dashboard.ts";

describe("formatRoutingSummary", () => {
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
        expect(lines.join("\n")).toContain("Completed                  1 (100.0%)");
        expect(lines.join("\n")).toContain("Fast to base               1 (100.0%)");
        expect(lines.join("\n")).toContain("Escalated recovery         1 (100.0%)");
        expect(lines.join("\n")).toContain("Deep recovery              1 (100.0%)");
        expect(lines.join("\n")).toContain("Mean cost/success          $0.50");
        expect(lines.join("\n")).toContain("test/deep");
        expect(lines.join("\n")).toContain("$0.50");
        expect(lines.join("\n")).not.toContain("task-1");
    });
});
