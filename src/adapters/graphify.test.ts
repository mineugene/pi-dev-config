import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import registerGraphify, { GRAPH_USE_POLICY, graphExists } from "./graphify.ts";

interface BeforeResult {
    systemPrompt?: string;
}

type BeforeHandler = (
    event: { systemPrompt: string },
    ctx: { cwd: string },
) => Promise<BeforeResult | undefined>;
type ToolHandler = (event: { toolName: string; input: unknown }) => void;
type CommandHandler = (args: string) => Promise<void>;

function setup() {
    let beforeHandler: BeforeHandler | undefined;
    let toolHandler: ToolHandler | undefined;
    let commandHandler: CommandHandler | undefined;
    const sendUserMessage = vi.fn();
    const pi = {
        on(name: string, handler: unknown) {
            if (name === "before_agent_start") beforeHandler = handler as BeforeHandler;
            if (name === "tool_call") toolHandler = handler as ToolHandler;
        },
        registerCommand(name: string, definition: { handler: CommandHandler }) {
            if (name === "graphify") commandHandler = definition.handler;
        },
        sendUserMessage,
    };

    registerGraphify(pi as unknown as Parameters<typeof registerGraphify>[0], {
        current: { graphify: { enabled: true } },
    });
    if (!beforeHandler || !toolHandler || !commandHandler) {
        throw new Error("Graphify handlers were not registered");
    }
    return { beforeHandler, toolHandler, commandHandler, sendUserMessage };
}

describe("Graphify graph-use policy", () => {
    test("activates only when graph.json exists", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "pidev-graphify-"));
        const { beforeHandler } = setup();
        try {
            expect(graphExists(cwd)).toBe(false);
            expect(await beforeHandler({ systemPrompt: "base" }, { cwd })).toBeUndefined();

            mkdirSync(join(cwd, "graphify-out"));
            writeFileSync(join(cwd, "graphify-out", "graph.json"), "{}");
            expect(graphExists(cwd)).toBe(true);
            expect(await beforeHandler({ systemPrompt: "base" }, { cwd })).toEqual({
                systemPrompt: `base\n\n${GRAPH_USE_POLICY}`,
            });
        } finally {
            rmSync(cwd, { force: true, recursive: true });
        }
    });

    test("requires a query before broad exploration", () => {
        expect(GRAPH_USE_POLICY).toContain('graphify query "<task>"');
        expect(GRAPH_USE_POLICY).toContain("read");
        expect(GRAPH_USE_POLICY).toContain("grep");
        expect(GRAPH_USE_POLICY).toContain("find");
    });

    test("queues a plain graph build request and expands explicit skill commands", async () => {
        const { commandHandler, sendUserMessage, toolHandler } = setup();

        for (let index = 0; index < 12; index++) {
            toolHandler({ toolName: "read", input: { path: `src/${index % 6}.ts` } });
        }
        expect(sendUserMessage).toHaveBeenCalledWith(
            "Update the Graphify knowledge graph for the current directory. Run `graphify .` and report the output location and result.",
            { deliverAs: "followUp" },
        );

        await commandHandler("query adapters");
        expect(sendUserMessage).toHaveBeenLastCalledWith("/skill:graphify query adapters", {
            expandPromptTemplates: true,
        });
    });

    test("gives child agents the policy without queueing builds", () => {
        const previous = process.env.PIDEV_SUBAGENT;
        const on = vi.fn();
        const registerCommand = vi.fn();
        process.env.PIDEV_SUBAGENT = "explore";
        try {
            registerGraphify(
                { on, registerCommand } as unknown as Parameters<typeof registerGraphify>[0],
                { current: { graphify: { enabled: true } } },
            );
        } finally {
            if (previous === undefined) delete process.env.PIDEV_SUBAGENT;
            else process.env.PIDEV_SUBAGENT = previous;
        }

        expect(on).toHaveBeenCalledOnce();
        expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
        expect(registerCommand).not.toHaveBeenCalled();
    });
});
