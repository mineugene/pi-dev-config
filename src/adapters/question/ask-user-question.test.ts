import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.ts";

type AskUserQuestionTool = {
    execute(
        toolCallId: string,
        params: {
            question: string;
            header?: string;
            options: Array<{
                label: string;
                description?: string;
                recommended?: boolean;
            }>;
        },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: {
            hasUI: boolean;
            ui: {
                select(title: string, options: string[]): Promise<string | undefined>;
                input(prompt: string, placeholder?: string): Promise<string | undefined>;
            };
        },
    ): Promise<{
        content: Array<{ type: "text"; text: string }>;
        details: {
            question: string;
            answer: string | null;
            wasCustom?: boolean;
            wasChat?: boolean;
        };
    }>;
};

test("uses the native selector and input for custom answers", async () => {
    let tool: AskUserQuestionTool | undefined;
    registerAskUserQuestionTool({
        registerTool: (registered: AskUserQuestionTool) => {
            tool = registered;
        },
    } as unknown as ExtensionAPI);
    if (!tool) throw new Error("Ask user question tool was not registered");
    const select = vi.fn().mockResolvedValue("3. Type something.");
    const input = vi.fn().mockResolvedValue("Use SQLite");

    const result = await tool.execute(
        "call-1",
        {
            question: "Which database?",
            header: "Storage",
            options: [
                { label: "Postgres", description: "For shared deployments", recommended: true },
                { label: "SQLite" },
            ],
        },
        undefined,
        undefined,
        { hasUI: true, ui: { select, input } },
    );

    expect(select).toHaveBeenCalledWith("Storage\nWhich database?", [
        "1. Postgres (★ Recommended) - For shared deployments",
        "2. SQLite",
        "3. Type something.",
        "4. Chat about this",
    ]);
    expect(input).toHaveBeenCalledWith("Which database?", "Type your answer");
    expect(result).toEqual({
        content: [{ type: "text", text: "User answered: Use SQLite" }],
        details: { question: "Which database?", answer: "Use SQLite", wasCustom: true },
    });
});
