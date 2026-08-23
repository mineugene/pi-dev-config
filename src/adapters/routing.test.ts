import type { Api, Model } from "@earendil-works/pi-ai";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { PiDevConfig, RoutingThinkingLevel } from "../infra/config.ts";
import registerRouting from "./routing.ts";

function model(id: string): Model<Api> {
    return {
        id,
        name: id,
        provider: "test",
        api: "openai-completions",
        baseUrl: "https://example.test",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4_096,
    };
}

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
type SessionEntry = { type: "custom"; customType: string; data: unknown };

function setup(config: PiDevConfig, entries: SessionEntry[] = []) {
    const base = model("base");
    const fast = model("fast");
    const deep = model("deep");
    const manual = model("manual");
    const models = [base, fast, deep, manual];
    const handlers = new Map<string, Handler>();
    const eventHandlers = new Map<string, (data: unknown) => void>();
    const commands = new Map<string, CommandHandler>();
    const setModels: string[] = [];
    const thinkingLevels: RoutingThinkingLevel[] = [];
    let currentModel = base;
    let currentThinking: RoutingThinkingLevel = "high";

    const ctx = {
        model: base,
        signal: undefined,
        hasUI: true,
        isIdle: vi.fn(() => true),
        waitForIdle: vi.fn(async () => {}),
        ui: { notify: vi.fn(), select: vi.fn(), setStatus: vi.fn() },
        sessionManager: {
            getBranch: () => entries,
            getEntries: () => entries,
        },
        modelRegistry: {
            getAvailable: () => models,
            getProvider: () => undefined,
            getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }),
        },
    };

    const pi = {
        on(name: string, handler: Handler) {
            handlers.set(name, handler);
        },
        events: {
            on(name: string, handler: (data: unknown) => void) {
                eventHandlers.set(name, handler);
            },
        },
        registerCommand(name: string, command: { handler: CommandHandler }) {
            commands.set(name, command.handler);
        },
        appendEntry(customType: string, data: unknown) {
            entries.push({ type: "custom", customType, data });
        },
        getThinkingLevel: () => currentThinking,
        setThinkingLevel(level: RoutingThinkingLevel) {
            currentThinking = level;
            thinkingLevels.push(level);
        },
        async setModel(next: Model<Api>) {
            const previousModel = currentModel;
            currentModel = next;
            setModels.push(next.id);
            await handlers.get("model_select")?.(
                { model: next, previousModel, source: "set" },
                ctx as unknown as ExtensionContext,
            );
            return true;
        },
    };

    registerRouting(pi as unknown as ExtensionAPI, { current: config });

    const emit = async (name: string, event: Record<string, unknown> = {}) => {
        await handlers.get(name)?.(event, ctx as unknown as ExtensionContext);
    };

    return {
        base,
        commands,
        ctx,
        deep,
        emit,
        entries,
        eventHandlers,
        fast,
        handlers,
        manual,
        setModels,
        thinkingLevels,
    };
}

async function start(harness: ReturnType<typeof setup>): Promise<void> {
    await harness.emit("session_start", { reason: "startup" });
}

async function prompt(
    harness: ReturnType<typeof setup>,
    text: string,
    expandedPrompt = text,
): Promise<void> {
    await harness.emit("input", { text, source: "interactive" });
    await harness.emit("before_agent_start", { prompt: expandedPrompt, images: [] });
}

async function endTurn(
    harness: ReturnType<typeof setup>,
    options: { stopReason?: string; toolResults?: Array<{ isError: boolean }> } = {},
): Promise<void> {
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    await harness.emit("turn_end", {
        turnIndex: 0,
        message: { stopReason: options.stopReason ?? "stop" },
        toolResults: options.toolResults ?? [],
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("model routing", () => {
    test("starts a simple subtask on fast and keeps its prompt prefix", async () => {
        const harness = setup({
            routing: {
                fast: { model: "fast", thinkingLevel: "low" },
                deep: { model: "deep", thinkingLevel: "max" },
            },
        });
        await start(harness);

        await prompt(harness, "Format this file");
        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · first pass: test/fast",
        );
        expect(harness.thinkingLevels).toContain("low");

        await harness.emit("agent_end", { messages: [] });
        expect(harness.setModels).toEqual(["fast"]);
    });

    test("selects the configured preset and switches named presets by command", async () => {
        const harness = setup({
            routing: {
                defaultPreset: "general",
                presets: {
                    general: { base: "base", fast: "fast", deep: "deep" },
                    "github-copilot": { base: "manual", fast: "deep", deep: "fast" },
                },
            },
        });
        await start(harness);
        await prompt(harness, "Format this file");
        expect(harness.setModels).toEqual(["fast"]);

        await harness.commands.get("routing-preset")?.(
            "github-copilot",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast", "manual", "deep"]);
        expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
            "Routing preset activated: github-copilot",
            "info",
        );
        expect(harness.ctx.ui.setStatus).toHaveBeenCalledWith("routing-profile", "github-copilot");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · first pass: test/deep",
        );
    });

    test("reports that a routing preset is queued until current work finishes", async () => {
        const harness = setup({
            routing: {
                defaultPreset: "general",
                presets: {
                    general: { base: "base", fast: "fast" },
                    alternate: { base: "manual", fast: "deep" },
                },
            },
        });
        await start(harness);
        harness.ctx.isIdle.mockReturnValue(false);
        let releaseIdle: () => void = () => {};
        harness.ctx.waitForIdle.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseIdle = resolve;
                }),
        );

        const switching = harness.commands.get("routing-preset")?.(
            "alternate",
            harness.ctx as unknown as ExtensionCommandContext,
        );

        expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
            "Routing preset will apply after the current work is done: alternate",
            "info",
        );
        expect(harness.setModels).toEqual([]);

        releaseIdle();
        await switching;

        expect(harness.setModels).toEqual(["manual"]);
        expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
            "Routing preset activated: alternate",
            "info",
        );
    });

    test("restores the selected routing preset with the session", async () => {
        const config: PiDevConfig = {
            routing: {
                defaultPreset: "general",
                presets: {
                    general: { base: "base", fast: "fast" },
                    alternate: { base: "manual", fast: "deep" },
                },
            },
        };
        const first = setup(config);
        await start(first);
        await first.commands.get("routing-preset")?.(
            "alternate",
            first.ctx as unknown as ExtensionCommandContext,
        );

        const resumed = setup(config, first.entries);
        await start(resumed);
        await prompt(resumed, "Format this file");

        expect(resumed.setModels).toEqual(["manual", "deep"]);
    });

    test("starts fresh after the acknowledgement turn for a completed task", async () => {
        const harness = setup({ routing: { fast: "fast", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, "Format this file");
        await endTurn(harness);

        await prompt(harness, "done");
        await endTurn(harness);
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast"]);
    });

    test("routes complex and expanded prompts straight to base", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);

        await prompt(
            harness,
            "/skill:review src/auth.ts",
            "Review and refactor the authentication implementation",
        );

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("routing", "routing: base");
    });

    test("gives fast one response before base handles a tool continuation", async () => {
        const harness = setup({ routing: { fast: "fast", deep: "deep" } });
        await start(harness);
        await prompt(harness, "Format this file");

        await endTurn(harness, { toolResults: [{ isError: false }] });

        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("routing", "routing: base");
    });

    test("escalates after consecutive base failures and holds deep", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                deep: { model: "deep", thinkingLevel: "max" },
                failureThreshold: 2,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, { toolResults: [{ isError: true }] });
        expect(harness.setModels).toEqual([]);

        await endTurn(harness, { toolResults: [{ isError: true }] });
        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
            "Routing escalated: test/deep",
            "info",
        );
        expect(harness.thinkingLevels.at(-1)).toBe("max");

        await harness.emit("agent_end", { messages: [] });
        await prompt(harness, "and retry that check");
        expect(harness.setModels).toEqual(["deep"]);
    });

    test("escalates repeated user corrections independently of successful retries", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                deep: "deep",
                failureThreshold: 5,
                correctionThreshold: 2,
                cacheTtlMinutes: 0,
            },
        });
        await start(harness);
        await prompt(harness, "Format this file");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "That was not exactly right");
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "You overlooked the error handling");
        expect(harness.setModels).toEqual(["fast", "base", "deep"]);
    });

    test("routes queued correction feedback before the next internal turn", async () => {
        const harness = setup({
            routing: { deep: "deep", correctionThreshold: 1 },
        });
        await start(harness);
        await prompt(harness, "Debug the integration");

        await harness.emit("input", {
            text: "that's wrong, try again",
            source: "interactive",
            streamingBehavior: "steer",
        });
        await endTurn(harness);

        expect(harness.setModels).toEqual(["deep"]);
    });

    test("counts every correction queued before the next turn", async () => {
        const harness = setup({
            routing: { deep: "deep", correctionThreshold: 2 },
        });
        await start(harness);
        await prompt(harness, "Debug the integration");

        await harness.emit("input", {
            text: "This is wrong",
            source: "interactive",
            streamingBehavior: "steer",
        });
        await harness.emit("input", {
            text: "Retry that",
            source: "interactive",
            streamingBehavior: "steer",
        });
        await endTurn(harness);

        expect(harness.setModels).toEqual(["deep"]);
    });

    test("defers todo completion reset until the agent settles", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                deep: "deep",
                correctionThreshold: 1,
                cacheTtlMinutes: 0,
            },
        });
        await start(harness);
        await prompt(harness, "Review the integration");
        harness.eventHandlers.get("pidev:task_complete")?.({ source: "todo" });
        await harness.emit("input", {
            text: "This is wrong",
            source: "interactive",
            streamingBehavior: "steer",
        });

        await endTurn(harness);
        expect(harness.setModels).toEqual(["deep"]);

        await harness.emit("agent_settled");
        await prompt(harness, "Format another file");
        expect(harness.setModels).toEqual(["deep", "fast"]);
    });

    test("routes an image-bearing simple prompt to base", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await harness.emit("input", {
            text: "Describe this",
            source: "interactive",
            images: [{}],
        });
        await harness.emit("before_agent_start", {
            prompt: "Describe this",
            images: [],
        });

        expect(harness.setModels).toEqual([]);
    });

    test("a fast failure falls back to base without skipping to deep", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                deep: "deep",
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Rename one local variable");

        await endTurn(harness, { toolResults: [{ isError: true }] });

        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.setModels).not.toContain("deep");
    });

    test("keeps a fast failure pending across agent runs in the same subtask", async () => {
        const harness = setup({ routing: { fast: "fast", deep: "deep" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(harness, { stopReason: "error" });
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "and retry that rename");

        expect(harness.setModels).toEqual(["fast", "base"]);
    });

    test("holds a warm base prefix instead of downshifting on a new task", async () => {
        const harness = setup({
            routing: { fast: "fast", cacheTtlMinutes: 5 },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · warm prefix: 5m",
        );
    });

    test("holds a warm deep prefix after its task finishes", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                deep: "deep",
                correctionThreshold: 1,
                cacheTtlMinutes: 5,
            },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await prompt(harness, "That was not exactly right");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · warm prefix: 5m",
        );
    });

    test("downshifts after the prompt-cache lease expires", async () => {
        const harness = setup({
            routing: { fast: "fast", cacheTtlMinutes: 5 },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });
        vi.advanceTimersByTime(5 * 60_000 + 1);

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast"]);
    });

    test("restores the configured baseline and automatic routing on /routing-auto", async () => {
        const harness = setup({
            routing: { base: "manual", fast: "fast", deep: "deep", cacheTtlMinutes: 0 },
        });
        await start(harness);
        await prompt(harness, "Format this file");
        await harness.handlers.get("model_select")?.(
            { model: harness.deep, previousModel: harness.fast, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );

        await harness.commands.get("routing-auto")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["manual", "fast", "manual", "fast"]);
        expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
            "Automatic routing restored: test/manual",
            "info",
        );
    });

    test("uses the session-start model as the default routing baseline", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await harness.handlers.get("model_select")?.(
            { model: harness.manual, previousModel: harness.base, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );

        await harness.commands.get("routing-auto")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );

        expect(harness.setModels).toEqual(["base"]);
    });

    test("backs off after a manual model selection until a new subtask", async () => {
        const harness = setup({
            routing: { fast: "fast", deep: "deep", cacheTtlMinutes: 0 },
        });
        await start(harness);
        await prompt(harness, "Format this file");

        await harness.handlers.get("model_select")?.(
            { model: harness.manual, previousModel: harness.fast, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: manual override",
        );
        await prompt(harness, "and update that comment");
        expect(harness.setModels).toEqual(["fast"]);

        await prompt(harness, "Explain the OAuth flow");
        expect(harness.setModels).toEqual(["fast", "fast"]);
    });
});
