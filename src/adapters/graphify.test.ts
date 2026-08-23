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
interface CommandContext {
    cwd: string;
    hasUI: boolean;
    ui: { setStatus: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
}
type CommandHandler = (args: string, ctx: CommandContext) => Promise<void>;

function setup(enabled = true) {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    let beforeHandler: BeforeHandler | undefined;
    let commandHandler: CommandHandler | undefined;
    const sendUserMessage = vi.fn();
    const on = vi.fn((name: string, handler: unknown) => {
        handlers.set(name, handler as (event: unknown, ctx: unknown) => unknown);
        if (name === "before_agent_start") beforeHandler = handler as BeforeHandler;
    });
    const pi = {
        on,
        registerCommand(name: string, definition: { handler: CommandHandler }) {
            if (name === "graphify") commandHandler = definition.handler;
        },
        sendUserMessage,
    };

    const config = { current: { graphify: { enabled } } };
    registerGraphify(pi as unknown as Parameters<typeof registerGraphify>[0], config);
    if (enabled && (!beforeHandler || !commandHandler)) {
        throw new Error("Graphify handlers were not registered");
    }
    const setStatus = vi.fn();
    const notify = vi.fn();
    const ctx = { cwd: "/repo", hasUI: true, ui: { setStatus, notify } };
    const emit = (name: string, context = ctx) => handlers.get(name)?.({}, context);
    return {
        beforeHandler: beforeHandler!,
        commandHandler: commandHandler!,
        on,
        sendUserMessage,
        setStatus,
        notify,
        config,
        ctx,
        emit,
    };
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
        expect(GRAPH_USE_POLICY).not.toContain("needs_update");
        expect(GRAPH_USE_POLICY).toContain("Do not refresh or extract automatically");
    });

    test("never queues graph work and expands explicit skill commands", async () => {
        const { commandHandler, on, sendUserMessage, ctx } = setup();

        expect(on).not.toHaveBeenCalledWith("tool_call", expect.any(Function));
        expect(sendUserMessage).not.toHaveBeenCalled();

        await commandHandler("query adapters", ctx);
        expect(sendUserMessage).toHaveBeenCalledWith("/skill:graphify query adapters", {
            expandPromptTemplates: true,
        });
    });

    test("stops injecting policy when disabled at runtime", async () => {
        const harness = setup();
        harness.config.current.graphify.enabled = false;
        expect(await harness.beforeHandler({ systemPrompt: "base" }, harness.ctx)).toBeUndefined();
        expect(harness.setStatus).not.toHaveBeenCalled();
    });

    test("disabled processes register no hooks", () => {
        expect(setup(false).on).not.toHaveBeenCalled();
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
