/** Proves the compact status note reaches the parent through the Agent renderer. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import subagentsExtension from "../index.ts";

function makePi() {
    const tools = new Map<string, ToolDefinition>();
    const pi = {
        registerMessageRenderer: vi.fn(),
        registerTool: vi.fn((tool: ToolDefinition) => tools.set(tool.name, tool)),
        registerCommand: vi.fn(),
        on: vi.fn(),
        events: {
            emit: vi.fn(),
            on: vi.fn(() => vi.fn()),
        },
        appendEntry: vi.fn(),
        sendMessage: vi.fn(),
        getThinkingLevel: vi.fn(() => "off"),
    } as unknown as ExtensionAPI;
    return { pi, tools };
}

type ToolResultRenderer = NonNullable<ToolDefinition["renderResult"]>;
type ToolRendererTheme = Parameters<ToolResultRenderer>[2];
type ToolRendererContext = Parameters<ToolResultRenderer>[3];

const plainTheme: Pick<ToolRendererTheme, "fg" | "bold"> = {
    fg: (_color, text) => text,
    bold: (text) => text,
};

describe("status note reaches the parent through the real handlers", () => {
    it("renders compact running state without an empty spinner or thinking line", () => {
        const { pi, tools } = makePi();
        subagentsExtension(pi);

        const lines = tools.get("Agent")!.renderResult!(
            {
                content: [{ type: "text", text: "" }],
                details: { status: "running", description: "d", toolUses: 0, toolCalls: [] },
            },
            { expanded: false, isPartial: true },
            plainTheme as unknown as ToolRendererTheme,
            { args: { prompt: "go" } } as unknown as ToolRendererContext,
        ).render(80);

        expect(lines).toEqual(["⎿  Running… (ctrl+o to expand)"]);
    });
});
