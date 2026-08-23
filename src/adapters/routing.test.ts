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
    const escalated = model("escalated");
    const deep = model("deep");
    const manual = model("manual");
    const models = [base, fast, escalated, deep, manual];
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
        escalated,
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
    options: {
        stopReason?: string;
        usage?: {
            input?: number;
            output?: number;
            reasoning?: number;
            cacheRead?: number;
            cacheWrite?: number;
            cost?: { total?: number };
        };
        content?: Array<{
            type: string;
            name?: string;
            arguments?: unknown;
        }>;
        toolResults?: Array<{
            isError: boolean;
            toolName?: string;
            content?: Array<{ text?: string }>;
        }>;
    } = {},
): Promise<void> {
    await harness.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
    await harness.emit("turn_end", {
        turnIndex: 0,
        message: {
            stopReason: options.stopReason ?? "stop",
            usage: options.usage,
            content: options.content,
        },
        toolResults: options.toolResults ?? [],
    });
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe("model routing", () => {
    test.each([
        ["What does parseConfig return?", "fast", "low risk"],
        ["Add CSV export", "base", "uncertain risk"],
        ["TypeError: broken", "base", "high risk: stack trace"],
    ])("chooses and records the entry route for %j", async (text, role, label) => {
        const harness = setup({ routing: { base: "base", fast: "fast", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, text);
        expect(harness.setModels).toEqual(role === "fast" ? ["fast"] : []);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            `routing: ${role} · ${label}`,
        );
        await endTurn(harness);
        await prompt(harness, "done");
        const record = harness.entries.find(
            (entry) => entry.customType === "pidev:routing-task",
        )?.data;
        expect(record).toMatchObject({
            entryRisk: label.split(" ")[0],
            entryReasons:
                role === "base" && text.startsWith("TypeError")
                    ? ["stack-trace", "multi-step-task"]
                    : [],
            startingRole: role,
        });
        expect(JSON.stringify(record)).not.toContain(text);
    });

    test.each(["Rename one local variable", "Add CSV export", "Fix the parser bug"])(
        "uses base without a fast target for %j",
        async (text) => {
            const harness = setup({ routing: { base: "base", deep: "deep" } });
            await start(harness);
            await prompt(harness, text);
            expect(harness.setModels).toEqual([]);
        },
    );

    test("assesses an expanded command even when its expansion looks simple", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "/explain", "What is x?");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · high risk: multi-step task",
        );
    });
    test("collapses same-model routes with the same thinking level", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: { model: "base", thinkingLevel: "medium" },
                deep: { model: "base", thinkingLevel: "medium" },
            },
        });
        await start(harness);
        await prompt(harness, "Format this file");

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · low risk",
        );
    });

    test("collapses a duplicate deep target after the escalated target", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: "fast",
                escalated: { model: "base", thinkingLevel: "high" },
                deep: { model: "base", thinkingLevel: "high" },
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });

        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · assistant failure threshold reached",
        );
    });

    test("retains a deep target that repeats base after a distinct escalated target", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: "escalated",
                deep: { model: "base", thinkingLevel: "medium" },
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["escalated"]);

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["escalated", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · assistant failure threshold reached",
        );
    });

    test("uses same model at different effort levels across all recovery roles", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: { model: "base", thinkingLevel: "max" },
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });

        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels).toEqual(["medium", "high", "max"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · assistant failure threshold reached",
        );
    });

    test("keeps same-model routes with different thinking levels", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: { model: "base", thinkingLevel: "low" },
                deep: { model: "base", thinkingLevel: "max" },
            },
        });
        await start(harness);
        await prompt(harness, "Format this file");

        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels).toEqual(["medium", "low"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
    });

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
            "routing: fast · low risk",
        );
        expect(harness.thinkingLevels).toContain("low");

        await harness.emit("agent_end", { messages: [] });
        expect(harness.setModels).toEqual(["fast"]);
    });

    test("resolves the escalated target from the active named preset", async () => {
        const harness = setup({
            routing: {
                defaultPreset: "general",
                presets: {
                    general: {
                        base: "base",
                        escalated: "escalated",
                        deep: "deep",
                    },
                },
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");

        await endTurn(harness, { stopReason: "error" });

        expect(harness.setModels).toEqual(["escalated"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · assistant failure threshold reached",
        );
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
            "routing: fast · low risk",
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

    test("persists redacted routing task metrics at a completed task boundary", async () => {
        const harness = setup({ routing: { fast: "fast", deep: "deep", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, "Format this file");
        await endTurn(harness, {
            usage: {
                input: 10,
                output: 5,
                reasoning: 2,
                cacheRead: 3,
                cacheWrite: 2,
                cost: { total: 0.12 },
            },
        });

        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as Record<string, unknown> | undefined;
        expect(metrics).toMatchObject({
            preset: "default",
            startingRole: "fast",
            highestRole: "fast",
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 2,
            cachedInputTokens: 3,
            estimatedCost: 0.12,
            modelUsage: [
                {
                    model: "test/fast",
                    inputTokens: 10,
                    outputTokens: 5,
                    reasoningTokens: 2,
                    cachedInputTokens: 3,
                    estimatedCost: 0.12,
                },
            ],
            turns: 1,
            completed: true,
            outcome: "completed",
        });
        expect(metrics).not.toHaveProperty("prompt");
        expect(metrics).not.toHaveProperty("toolOutput");

        await endTurn(harness);
        await prompt(harness, "Format another file");
        expect(
            harness.entries.filter((entry) => entry.customType === "pidev:routing-task"),
        ).toHaveLength(1);
    });

    test.each([
        ["reply", "superseded"],
        ["model error", "unresolved"],
        ["pending check", "unresolved"],
        ["passing check", "superseded"],
        ["pending correction", "unresolved"],
        ["answered correction", "superseded"],
    ])("records %s as %s at a new request", async (scenario, outcome) => {
        const harness = setup({ routing: { fast: "fast", deep: "deep", failureThreshold: 1 } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        if (scenario.includes("check")) {
            await endTurn(harness, {
                toolResults: [
                    {
                        toolName: "bash",
                        isError: true,
                        content: [{ text: "FAIL src/parser.test.ts" }],
                    },
                ],
            });
            await endTurn(harness, { toolResults: [{ toolName: "edit", isError: false }] });
            await endTurn(harness);
            if (scenario === "passing check") {
                await endTurn(harness, {
                    toolResults: [
                        {
                            toolName: "bash",
                            isError: false,
                            content: [{ text: "Tests: 1 passed" }],
                        },
                    ],
                });
            }
        } else {
            await endTurn(harness, { stopReason: scenario === "model error" ? "error" : "stop" });
            if (scenario.includes("correction")) {
                await prompt(harness, "This is wrong");
                if (scenario === "answered correction") await endTurn(harness);
            }
        }
        await prompt(harness, "Add CSV export");
        expect(harness.entries.at(-1)?.data).toMatchObject({ outcome, completed: false });
    });

    test.each(["deep", "manual"])("keeps pending check evidence while on %s", async (role) => {
        const harness = setup({
            routing: { base: "base", fast: "fast", deep: "deep", failureThreshold: 1 },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        if (role === "deep") await endTurn(harness, { stopReason: "error" });
        else await harness.emit("model_select", { model: harness.manual, source: "set" });
        await endTurn(harness, {
            toolResults: [
                { toolName: "bash", isError: true, content: [{ text: "FAIL src/parser.test.ts" }] },
            ],
        });
        await endTurn(harness);
        await prompt(harness, "Add CSV export");
        expect(harness.entries.at(-1)?.data).toMatchObject({
            outcome: "unresolved",
            completed: false,
        });
    });

    test.each(["routing-auto", "routing-preset", "session_shutdown"])(
        "records interruption at %s",
        async (boundary) => {
            const harness = setup({
                routing: {
                    defaultPreset: "general",
                    presets: { general: { base: "base", fast: "fast" } },
                },
            });
            await start(harness);
            await prompt(harness, "Rename one local variable");
            await endTurn(harness);
            if (boundary === "session_shutdown") {
                await harness.emit(boundary);
                await harness.emit(boundary);
            } else {
                await harness.commands.get(boundary)?.(
                    boundary === "routing-preset" ? "general" : "",
                    harness.ctx as unknown as ExtensionCommandContext,
                );
            }
            const records = harness.entries.filter(
                (entry) => entry.customType === "pidev:routing-task",
            );
            expect(records).toHaveLength(1);
            expect(records[0]?.data).toMatchObject({ outcome: "interrupted", completed: false });
        },
    );

    test("records interruption even before the task's first response", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await harness.emit("session_shutdown");
        expect(harness.entries).toHaveLength(1);
        expect(harness.entries[0]?.data).toMatchObject({
            outcome: "interrupted",
            completed: false,
            turns: 0,
            entryRisk: "low",
        });
    });

    test("records a completed to-do task only once when the agent settles", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(harness);
        harness.eventHandlers.get("pidev:task_complete")?.({ source: "todo" });
        expect(harness.entries).toHaveLength(0);
        await harness.emit("agent_settled");
        await harness.emit("agent_settled");
        expect(harness.entries).toHaveLength(1);
        expect(harness.entries[0]?.data).toMatchObject({ outcome: "completed", completed: true });
    });

    test("records queued task boundaries without losing pending corrections or entry metrics", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await harness.emit("input", { text: "This is wrong", source: "interactive" });
        await harness.emit("input", { text: "Add CSV export", source: "interactive" });
        await endTurn(harness);
        expect(harness.entries[0]?.data).toMatchObject({ outcome: "unresolved", entryRisk: "low" });
        await endTurn(harness);
        await prompt(harness, "done");
        expect(harness.entries[1]?.data).toMatchObject({
            outcome: "completed",
            entryRisk: "uncertain",
            startingRole: "base",
            turns: 1,
        });
    });

    test("records automatic escalated and deep recovery telemetry", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness, { stopReason: "error" });
        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as { usedEscalated?: unknown; usedDeep?: unknown; highestRole?: unknown };
        expect(metrics).toMatchObject({
            highestRole: "deep",
            usedEscalated: true,
            usedDeep: true,
        });
    });

    test("keeps total correction telemetry when a rung budget resets", async () => {
        const harness = setup({
            routing: {
                base: "base",
                escalated: "escalated",
                correctionThreshold: 2,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        await endTurn(harness);
        await prompt(harness, "This is wrong");
        await endTurn(harness);
        await prompt(harness, "Retry that");
        await endTurn(harness);
        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as { correctionCount?: unknown };
        expect(metrics.correctionCount).toBe(2);
    });

    test("does not count a manually forced deep role as automatic escalation", async () => {
        const harness = setup({ routing: { base: "base", fast: "fast", deep: "deep" } });
        await start(harness);
        await harness.commands.get("routing-role")?.(
            "deep",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format one file");
        await endTurn(harness);
        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as { usedDeep?: unknown; highestRole?: unknown };
        expect(metrics).toMatchObject({ highestRole: "deep", usedDeep: false });
    });

    test("forces the explicit escalated role for one subtask", async () => {
        const harness = setup({
            routing: { base: "base", fast: "fast", escalated: "escalated", deep: "deep" },
        });
        await start(harness);

        await harness.commands.get("routing-role")?.(
            "escalated",
            harness.ctx as unknown as ExtensionCommandContext,
        );

        expect(harness.setModels).toEqual(["escalated"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · manual role",
        );
    });

    test("warns when the requested escalated role was omitted", async () => {
        const harness = setup({ routing: { base: "base", fast: "fast", deep: "deep" } });
        await start(harness);

        await harness.commands.get("routing-role")?.(
            "escalated",
            harness.ctx as unknown as ExtensionCommandContext,
        );

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
            "Routing role is not configured: escalated",
            "warning",
        );
    });

    test("does not count manual deep after automatic escalated recovery", async () => {
        const harness = setup({
            routing: {
                base: "base",
                escalated: "escalated",
                deep: "deep",
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        await endTurn(harness, { stopReason: "error" });
        await harness.commands.get("routing-role")?.(
            "deep",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await endTurn(harness);
        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as { usedEscalated?: unknown; usedDeep?: unknown };
        expect(metrics).toMatchObject({ usedEscalated: true, usedDeep: false });
    });

    test("does not mark a manually selected high base as router escalation", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
            },
        });
        await start(harness);
        await harness.handlers.get("thinking_level_select")?.(
            { level: "high", previousLevel: "medium" },
            harness.ctx as unknown as ExtensionContext,
        );
        await prompt(harness, "Debug the parser");
        await endTurn(harness);
        await prompt(harness, "done");

        const metrics = harness.entries.find((entry) => entry.customType === "pidev:routing-task")
            ?.data as { usedEscalated?: unknown };
        expect(metrics.usedEscalated).toBe(false);
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
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · high risk: security",
        );
    });

    test("keeps fast through six responses, counting parallel tools once", async () => {
        const harness = setup({ routing: { fast: "fast", deep: "deep" } });
        await start(harness);
        await prompt(harness, "Format this file");

        for (let response = 1; response <= 5; response++) {
            await endTurn(harness, { toolResults: [{ isError: false }, { isError: false }] });
            expect(harness.setModels).toEqual(["fast"]);
        }
        await endTurn(harness, { toolResults: [{ isError: false }] });
        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · fast turn limit",
        );
        await endTurn(harness);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({ handover: "limit", turns: 7 });
    });

    test("low-risk follow-ups share the fast response limit and never return to fast", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Format this file");
        for (let response = 1; response <= 6; response++) {
            await endTurn(harness);
            expect(harness.setModels).toEqual(["fast"]);
            await prompt(harness, "What does this return?");
            if (response < 6) expect(harness.setModels).toEqual(["fast"]);
        }
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await prompt(harness, "What does this return?");
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({ handover: "limit", turns: 8 });
    });

    test.each([
        ["error", "assistant failure"],
        ["length", "context limit"],
        ["repeated", "repeated tool calls"],
    ])("hands fast to base on %s with a clean recovery budget", async (failure, label) => {
        const harness = setup({
            routing: { fast: "fast", escalated: "escalated", failureThreshold: 2 },
        });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(
            harness,
            failure === "repeated"
                ? {
                      content: Array.from({ length: 10 }, () => ({
                          type: "toolCall",
                          name: "read",
                          arguments: { path: "x" },
                      })),
                  }
                : { stopReason: failure },
        );
        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            `routing: base · ${label}`,
        );
        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["fast", "base", "escalated"]);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({ handover: "failure" });
    });

    test("lets fast remediate an isolated check failure, then hands over on stagnation", async () => {
        const harness = setup({
            routing: { fast: "fast", escalated: "escalated", failureThreshold: 1 },
        });
        const failure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "FAIL src/parser.test.ts" }],
        };
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(harness, { toolResults: [failure] });
        expect(harness.setModels).toEqual(["fast"]);
        await endTurn(harness, { toolResults: [{ toolName: "edit", isError: false }] });
        expect(harness.setModels).toEqual(["fast"]);
        await endTurn(harness, { toolResults: [failure] });
        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · repeated test failure",
        );
        await endTurn(harness, { toolResults: [failure] });
        expect(harness.setModels).toEqual(["fast", "base"]);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({
            handover: "failure",
            stagnationEvents: 1,
        });
    });

    test.each([false, true])("hands over a non-low-risk follow-up (queued=%s)", async (queued) => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        if (queued) {
            await harness.emit("input", { text: "And add CSV export", source: "interactive" });
            await endTurn(harness);
        } else {
            await endTurn(harness);
            await prompt(harness, "And add CSV export");
        }
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await prompt(harness, "What does this return?");
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({
            entryRisk: "low",
            handover: "follow-up",
        });
    });

    test("records a correction handover and gives base a fresh correction budget", async () => {
        const harness = setup({
            routing: { fast: "fast", escalated: "escalated", correctionThreshold: 2 },
        });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(harness);
        await prompt(harness, "This is wrong");
        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · correction",
        );
        await endTurn(harness);
        await prompt(harness, "This is wrong");
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await prompt(harness, "This is wrong");
        expect(harness.setModels).toEqual(["fast", "base", "escalated"]);
        await endTurn(harness);
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).toMatchObject({
            handover: "correction",
            correctionCount: 3,
        });
    });

    test("manual overrides pause the fast limit and follow-up assessment", async () => {
        const harness = setup({ routing: { fast: "fast" } });
        await start(harness);
        await prompt(harness, "Rename one local variable");
        await endTurn(harness);
        await harness.commands.get("routing-role")?.(
            "fast",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        for (let response = 0; response < 7; response++) {
            await endTurn(harness, { toolResults: [{ isError: false }] });
            await prompt(harness, "And add CSV export");
        }
        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · manual role",
        );
        await prompt(harness, "done");
        expect(harness.entries.at(-1)?.data).not.toHaveProperty("handover");
    });

    test("does not enter escalated recovery for a grep no-match", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, {
            toolResults: [
                {
                    toolName: "grep",
                    isError: true,
                    content: [{ text: "No matches found for: deprecatedOption" }],
                },
            ],
        });

        expect(harness.thinkingLevels).not.toContain("high");
        expect(harness.setModels).toEqual([]);
    });

    test("escalates after the default repeated tool-call threshold", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const repeatedCall = {
            type: "toolCall",
            name: "bash",
            arguments: { command: "echo done", timeout: 10 },
        };
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, { content: Array.from({ length: 9 }, () => repeatedCall) });
        expect(harness.thinkingLevels).not.toContain("high");

        await endTurn(harness, { content: Array.from({ length: 10 }, () => repeatedCall) });

        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · repeated tool calls threshold reached",
        );
    });

    test("uses an explicit escalated setting with the session-model baseline", async () => {
        const harness = setup({
            routing: {
                fast: "fast",
                escalated: { model: "base", thinkingLevel: "xhigh" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "error" });
        await prompt(harness, "and continue debugging");

        expect(harness.thinkingLevels.at(-1)).toBe("xhigh");
        expect(harness.setModels).toEqual([]);
    });

    test("enters escalated recovery after a repeated development failure follows an edit", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const compilerFailure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "src/auth.ts:12:4 - error TS2322: invalid value" }],
        };
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, { toolResults: [compilerFailure] });
        expect(harness.thinkingLevels).not.toContain("high");

        await endTurn(harness, { toolResults: [{ toolName: "edit", isError: false }] });
        await endTurn(harness, { toolResults: [compilerFailure] });

        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · stagnation threshold reached",
        );
    });

    test("does not clear a development signature on prose without a passing check", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const compilerFailure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "src/auth.ts:12:4 - error TS2322: invalid value" }],
        };
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { toolResults: [compilerFailure] });
        await endTurn(harness, { toolResults: [{ toolName: "edit", isError: false }] });
        await endTurn(harness);
        await endTurn(harness, { toolResults: [compilerFailure] });

        expect(harness.thinkingLevels.at(-1)).toBe("high");
    });

    test("moves a repeatedly remediated development failure from escalated to deep", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const compilerFailure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "src/auth.ts:12:4 - error TS2322: invalid value" }],
        };
        const edit = { toolName: "edit", isError: false };
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { toolResults: [compilerFailure] });
        await endTurn(harness, { toolResults: [edit] });
        await endTurn(harness, { toolResults: [compilerFailure] });
        await endTurn(harness, { toolResults: [edit] });
        await endTurn(harness, { toolResults: [compilerFailure] });

        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · stagnation threshold reached",
        );
    });

    test("clears a development signature after a passing check", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const compilerFailure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "src/auth.ts:12:4 - error TS2322: invalid value" }],
        };
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { toolResults: [compilerFailure] });
        await endTurn(harness, {
            toolResults: [
                { toolName: "bash", isError: false, content: [{ text: "Tests: 1 passed" }] },
            ],
        });
        await endTurn(harness, { toolResults: [compilerFailure] });

        expect(harness.thinkingLevels).toEqual(["medium"]);
    });

    test("does not treat incidental pass text as a passing development check", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        const compilerFailure = {
            toolName: "bash",
            isError: true,
            content: [{ text: "src/auth.ts:12:4 - error TS2322: invalid value" }],
        };
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { toolResults: [compilerFailure] });
        await endTurn(harness, {
            toolResults: [
                {
                    toolName: "edit",
                    isError: false,
                    content: [{ text: "Successfully updated pass-through text" }],
                },
            ],
        });
        await endTurn(harness, { toolResults: [compilerFailure] });

        expect(harness.thinkingLevels.at(-1)).toBe("high");
    });

    test("enters escalated recovery after a context limit", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "length" });

        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · context limit threshold reached",
        );
    });

    test("uses each recovery rung before switching to deep", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: { model: "deep", thinkingLevel: "max" },
                failureThreshold: 2,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels.at(-1)).toBe("medium");

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · assistant failure threshold reached",
        );

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual([]);
        expect(harness.thinkingLevels.at(-1)).toBe("high");

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.thinkingLevels.at(-1)).toBe("max");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · assistant failure threshold reached",
        );
    });

    test("makes a new simple task eligible for fast after escalated recovery", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: "fast",
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
                cacheTtlMinutes: 0,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format one file");

        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
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

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual([]);

        await endTurn(harness, { stopReason: "error" });
        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.ctx.ui.notify).toHaveBeenLastCalledWith(
            "Routing escalated: deep · test/deep",
            "info",
        );
        expect(harness.thinkingLevels.at(-1)).toBe("max");

        await harness.emit("agent_end", { messages: [] });
        await prompt(harness, "and retry that check");
        expect(harness.setModels).toEqual(["deep"]);
    });

    test("enters escalated recovery on correction feedback before deep", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                correctionThreshold: 1,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the integration");
        await endTurn(harness);

        await prompt(harness, "This is wrong");

        expect(harness.thinkingLevels.at(-1)).toBe("high");
        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: escalated · correction threshold reached",
        );
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
        expect(harness.setModels).toEqual(["fast", "base"]);
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Retry that correction");
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
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · uncertain risk: image input",
        );
    });

    test("reports the meaningful reason when fast falls back to base", async () => {
        const harness = setup({ routing: { fast: "fast", deep: "deep", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, "Rename one local variable");

        await endTurn(harness, { stopReason: "error" });
        await prompt(harness, "and retry that rename");

        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · assistant failure",
        );
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

        await endTurn(harness, { stopReason: "error", toolResults: [{ isError: true }] });

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

    test("uses a target cache TTL before the global routing TTL", async () => {
        const harness = setup({
            routing: {
                defaultPreset: "general",
                cacheTtlMinutes: 0,
                presets: {
                    general: {
                        base: { model: "base", cacheTtlMinutes: 10 },
                        fast: "fast",
                    },
                },
            },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · warm route: 10m",
        );
    });

    test("uses a preset cache TTL before the global routing TTL", async () => {
        const harness = setup({
            routing: {
                defaultPreset: "general",
                cacheTtlMinutes: 0,
                presets: {
                    general: { base: "base", fast: "fast", cacheTtlMinutes: 7 },
                },
            },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual([]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · warm route: 7m",
        );
    });

    test.each([undefined, "short", "long"])(
        "has no default warm hold with PI_CACHE_RETENTION=%s",
        async (retention) => {
            vi.stubEnv("PI_CACHE_RETENTION", retention);
            const harness = setup({ routing: { fast: "fast" } });
            harness.base.provider = "openai";
            await start(harness);
            await prompt(harness, "Review the parser");
            await endTurn(harness);
            await harness.emit("agent_end", { messages: [] });

            await prompt(harness, "Format another file");

            expect(harness.setModels).toEqual(["fast"]);
            expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
                "routing",
                "routing: fast · low risk",
            );
        },
    );

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
            "routing: base · warm route: 5m",
        );
    });

    test("starts a new task on fast after deep even with a TTL", async () => {
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

        expect(harness.setModels).toEqual(["deep", "fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
    });

    test("starts a new task on fast after same-model recovery even with a TTL", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: { model: "fast", thinkingLevel: "low" },
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
                cacheTtlMinutes: 5,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        await endTurn(harness, { stopReason: "error" });
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.thinkingLevels.at(-1)).toBe("low");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
    });

    test("starts a new task on fast after distinct-model recovery even with a TTL", async () => {
        const harness = setup({
            routing: {
                base: "base",
                fast: "fast",
                escalated: "escalated",
                deep: "deep",
                failureThreshold: 1,
                cacheTtlMinutes: 5,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the parser");
        await endTurn(harness, { stopReason: "error" });
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["escalated", "fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
    });

    test.each(["fast", "escalated", "deep"] as const)("ignores a TTL on %s", async (role) => {
        const harness = setup({
            routing: {
                base: "base",
                fast: "fast",
                escalated: "escalated",
                deep: "deep",
                [role]: { model: role, cacheTtlMinutes: 1_440 },
            },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await prompt(harness, "Rename one local variable");
        expect(harness.setModels).toEqual(["fast"]);
    });

    test.each(["escalated", "deep"] as const)(
        "returns from %s to base for a new uncertain task",
        async (role) => {
            const harness = setup({
                routing: {
                    base: { model: "base", thinkingLevel: "medium" },
                    fast: "fast",
                    [role]: { model: "base", thinkingLevel: "max" },
                    failureThreshold: 1,
                    cacheTtlMinutes: 100,
                },
            });
            await start(harness);
            await prompt(harness, "Debug the parser");
            await endTurn(harness, { stopReason: "error" });
            await endTurn(harness);
            await prompt(harness, "Add CSV export");
            expect(harness.thinkingLevels.at(-1)).toBe("medium");
            expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
                "routing",
                "routing: base · uncertain risk",
            );
        },
    );

    test("does not move a warm-held task to fast when its TTL expires", async () => {
        const harness = setup({ routing: { fast: "fast", cacheTtlMinutes: 5 } });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        vi.advanceTimersByTime(4 * 60_000);
        await prompt(harness, "Rename one local variable");
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: base · warm route: 1m",
        );
        await endTurn(harness);
        vi.advanceTimersByTime(10 * 60_000);
        await prompt(harness, "What does this return?");
        expect(harness.setModels).toEqual([]);
    });

    test("downshifts after the prompt-cache lease expires", async () => {
        const harness = setup({
            routing: { fast: "fast", cacheTtlMinutes: 5 },
        });
        await start(harness);
        await prompt(harness, "Review the parser");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });
        vi.advanceTimersByTime(5 * 60_000);

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast"]);
    });

    test("forces a semantic role until /routing-auto resumes routing", async () => {
        const harness = setup({
            routing: { base: "base", fast: "fast", deep: "deep", cacheTtlMinutes: 0 },
        });
        await start(harness);

        await harness.commands.get("routing-role")?.(
            "deep",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        expect(harness.setModels).toEqual(["deep"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: deep · manual role",
        );

        await prompt(harness, "Format this file");
        expect(harness.setModels).toEqual(["deep"]);

        await harness.commands.get("routing-auto")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["deep", "base", "fast"]);
    });

    test("does not warm-hold a manually forced deep role into the next task", async () => {
        const harness = setup({ routing: { base: "base", fast: "fast", deep: "deep" } });
        await start(harness);
        await harness.commands.get("routing-role")?.(
            "deep",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format one file");
        await endTurn(harness);
        await harness.emit("agent_end", { messages: [] });

        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["deep", "fast"]);
    });

    test("resets escalated effort before resuming automatic routing", async () => {
        const harness = setup({
            routing: {
                base: { model: "base", thinkingLevel: "medium" },
                fast: "fast",
                escalated: { model: "base", thinkingLevel: "high" },
                deep: "deep",
                failureThreshold: 1,
                cacheTtlMinutes: 0,
            },
        });
        await start(harness);
        await prompt(harness, "Debug the failing integration");
        await endTurn(harness, { stopReason: "error" });
        expect(harness.thinkingLevels.at(-1)).toBe("high");

        await harness.commands.get("routing-auto")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Format one file");

        expect(harness.thinkingLevels.at(-1)).toBe("medium");
        expect(harness.setModels).toEqual(["fast"]);
    });

    test("accepts /route as the semantic-role alias", async () => {
        const harness = setup({ routing: { base: "base", fast: "fast", deep: "deep" } });
        await start(harness);

        await harness.commands.get("route")?.(
            "fast",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await harness.commands.get("route")?.(
            "auto",
            harness.ctx as unknown as ExtensionCommandContext,
        );

        expect(harness.setModels).toEqual(["fast", "base"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith("routing", "routing: base");
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

    test("keeps a manual model override across subtask boundaries until /routing-auto", async () => {
        const harness = setup({
            routing: { fast: "fast", deep: "deep", cacheTtlMinutes: 0 },
        });
        await start(harness);
        await prompt(harness, "Format this file");

        await harness.handlers.get("model_select")?.(
            { model: harness.manual, previousModel: harness.fast, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );
        expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
            "Model override active: test/manual · use /routing-auto to resume automatic routing",
            "info",
        );
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: manual override",
        );
        await prompt(harness, "and update that comment");
        expect(harness.setModels).toEqual(["fast"]);

        await prompt(harness, "Explain the OAuth flow");
        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: manual override",
        );

        await harness.commands.get("routing-auto")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        await prompt(harness, "Rename one local variable");

        expect(harness.setModels).toEqual(["fast", "base", "fast"]);
    });

    test("keeps a manual model override across a completed task boundary", async () => {
        const harness = setup({ routing: { fast: "fast", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, "Format this file");
        await endTurn(harness);

        await harness.handlers.get("model_select")?.(
            { model: harness.manual, previousModel: harness.fast, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );
        await prompt(harness, "done");
        await endTurn(harness);
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: manual override",
        );
    });

    test("clears a manual model override when the session restarts", async () => {
        const harness = setup({ routing: { fast: "fast", cacheTtlMinutes: 0 } });
        await start(harness);
        await prompt(harness, "Format this file");
        await harness.handlers.get("model_select")?.(
            { model: harness.manual, previousModel: harness.fast, source: "set" },
            harness.ctx as unknown as ExtensionContext,
        );

        await start(harness);
        await prompt(harness, "Format another file");

        expect(harness.setModels).toEqual(["fast", "fast"]);
        expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith(
            "routing",
            "routing: fast · low risk",
        );
    });
});
