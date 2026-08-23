import type {
    AgentSession,
    AgentToolResult,
    ExtensionAPI,
    ExtensionContext,
    ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-runner.js", async () => {
    const actual = await vi.importActual<typeof import("../agent-runner.ts")>("../agent-runner.js");
    return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../agent-runner.ts";
import subagentsExtension from "../index.ts";

function makePi(active = ["Agent", "read"]) {
    const tools = new Map<string, ToolDefinition>();
    const handlers = new Map<string, () => void>();
    const eventHandlers = new Map<string, (data: unknown) => void>();
    const pi = {
        registerMessageRenderer: vi.fn(),
        registerTool: vi.fn((tool: ToolDefinition) => tools.set(tool.name, tool)),
        registerCommand: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
        events: {
            emit: vi.fn((event: string, data: unknown) => eventHandlers.get(event)?.(data)),
            on: vi.fn((event: string, handler: (data: unknown) => void) => {
                eventHandlers.set(event, handler);
                return vi.fn();
            }),
        },
        appendEntry: vi.fn(),
        sendMessage: vi.fn(),
        getThinkingLevel: vi.fn(() => "off"),
        getActiveTools: vi.fn(() => active),
        setActiveTools: vi.fn((next: string[]) => (active = next)),
    } as unknown as ExtensionAPI;
    return { pi, tools, active: () => active, handlers };
}

function ctx() {
    return {
        hasUI: false,
        ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
        cwd: "/tmp",
        model: undefined,
        modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
        sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
        getSystemPrompt: vi.fn(() => "parent"),
    } as unknown as ExtensionContext;
}

const textOf = (result: AgentToolResult<unknown>): string => {
    const content = result.content[0];
    return content?.type === "text" ? content.text : "";
};

type ToolResultRenderer = NonNullable<ToolDefinition["renderResult"]>;
type ToolRendererTheme = Parameters<ToolResultRenderer>[2];
type ToolRendererContext = Parameters<ToolResultRenderer>[3];

const theme: Pick<ToolRendererTheme, "fg"> = { fg: (_color, text) => text };

describe("background helper tools", () => {
    afterEach(() => vi.restoreAllMocks());

    it("activates helpers for the first background workflow and keeps them", async () => {
        vi.mocked(runAgent).mockResolvedValue({
            responseText: "done result",
            session: { dispose: vi.fn() } as unknown as AgentSession,
        });
        const { pi, tools, active, handlers } = makePi();
        subagentsExtension(pi);

        expect(active()).toEqual(["Agent", "read"]);

        await tools
            .get("Agent")!
            .execute(
                "fg",
                { prompt: "go", description: "fg", subagent_type: "general-purpose" },
                undefined,
                undefined,
                ctx(),
            );
        expect(active()).toEqual(["Agent", "read"]);

        const spawn = await tools.get("Agent")!.execute(
            "bg",
            {
                prompt: "go",
                description: "bg",
                subagent_type: "general-purpose",
                run_in_background: true,
            },
            undefined,
            undefined,
            ctx(),
        );
        expect(active()).toEqual(["Agent", "read", "get_subagent_result", "steer_subagent"]);

        const id = textOf(spawn).match(/Agent ID: (\S+)/)?.[1];
        let out = "";
        for (let i = 0; i < 10; i++) {
            out = textOf(
                await tools
                    .get("get_subagent_result")!
                    .execute("r", { agent_id: id }, undefined, undefined, ctx()),
            );
            if (out.includes("done result")) break;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(out).toContain("done result");
        expect(active()).toEqual(["Agent", "read", "get_subagent_result", "steer_subagent"]);

        handlers.get("session_before_switch")?.();
        const rendered = tools.get("Agent")!.renderResult!(
            spawn,
            { expanded: false, isPartial: false },
            theme as unknown as ToolRendererTheme,
            { args: {}, toolCallId: "bg" } as unknown as ToolRendererContext,
        )
            .render(80)
            .join("\n");
        expect(rendered).toContain("Done");
        expect(rendered).not.toContain("Running in background");
    });

    it("renders helper tool results compactly until expanded", () => {
        const real = makePi();
        subagentsExtension(real.pi);
        const rendered = real.tools.get("get_subagent_result")!.renderResult!(
            {
                content: [{ type: "text", text: `FULL\n${"x".repeat(500)}` }],
                details: {
                    kind: "get_result",
                    agentId: "a1",
                    type: "explore",
                    status: "completed",
                    stats: "Tool uses: 8",
                    description: "d",
                    preview: "short",
                },
            },
            { expanded: false, isPartial: false },
            theme as unknown as ToolRendererTheme,
            { args: {}, toolCallId: "result" } as unknown as ToolRendererContext,
        )
            .render(80)
            .join("\n");

        expect(rendered).toContain("a1: explore | completed");
        expect(rendered).toContain("short");
        expect(rendered).not.toContain("xxxxx");
        expect(rendered).toContain("ctrl+o");
    });
});
