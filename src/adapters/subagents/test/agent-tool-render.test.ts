import { describe, expect, it } from "vitest";
import { renderAgentToolResult } from "../ui/agent-tool-render.ts";

const theme = {
    fg: (_colour: string, text: string) => text,
    bold: (text: string) => text,
};

describe("renderAgentToolResult", () => {
    it("outlines Explore result headings with thinking-card branches", () => {
        const component = renderAgentToolResult(
            {
                content: [
                    {
                        type: "text",
                        text: "**Inspect the code**\n\nDetails\n\n## Identify callers",
                    },
                ],
                details: {
                    displayName: "Explore",
                    description: "inspect code",
                    subagentType: "Explore",
                    toolUses: 2,
                    tokens: "",
                    durationMs: 100,
                    status: "completed",
                    toolCalls: ["Read(src/a.ts)", "Grep(foo)"],
                    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
                },
            },
            { expanded: false, isPartial: false },
            theme,
            { args: {} } as unknown as Parameters<typeof renderAgentToolResult>[3],
        );

        expect(component.render(80)).toEqual([
            "⎿  Done (+2 more tool uses · 0.1s)",
            "   ├─ Inspect the code",
            "   ╰─ Identify callers",
        ]);
    });
});
