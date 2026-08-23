/* oxlint-disable max-lines */
import { homedir } from "node:os";
import path from "node:path";
import type {
    AgentSession,
    AgentSessionEvent,
    ExtensionAPI,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    createAgentSession,
    defaultResourceLoaderCtor,
    loaderExtensionsRef,
    getAgentDir,
    sessionManagerInMemory,
    sessionManagerCreate,
    settingsManagerCreate,
    settingsManagerGetSessionDir,
} = vi.hoisted(() => ({
    createAgentSession: vi.fn(),
    defaultResourceLoaderCtor: vi.fn(),
    loaderExtensionsRef: {
        current: { extensions: [], errors: [], runtime: {} } as {
            extensions: Array<{ path: string; tools: Map<string, unknown> }>;
            errors: Array<{ path: string; error: string }>;
            runtime: Record<string, unknown>;
        },
    },
    getAgentDir: vi.fn(() => "/mock/agent-dir"),
    sessionManagerInMemory: vi.fn(() => ({
        kind: "memory-session-manager",
        appendCustomEntry: vi.fn(),
    })),
    sessionManagerCreate: vi.fn(() => ({
        kind: "persistent-session-manager",
        appendCustomEntry: vi.fn(),
    })),
    settingsManagerGetSessionDir: vi.fn(() => undefined as string | undefined),
    settingsManagerCreate: vi.fn(() => ({
        kind: "settings-manager",
        getSessionDir: settingsManagerGetSessionDir,
    })),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
    CONFIG_DIR_NAME: ".pi",
    createAgentSession,
    // Mock loader simulates pi-mono: reload() applies additionalExtensionPaths
    // (an unknown path becomes an error row, mirroring a failed load) and then
    // runs extensionsOverride over the result.
    DefaultResourceLoader: class {
        opts: LoaderOptions;
        constructor(options: LoaderOptions) {
            this.opts = options;
            defaultResourceLoaderCtor(options);
        }

        async reload() {
            // Mirror the real loader: `noExtensions: true` zeros out the discovered set
            // entirely. Otherwise tests pre-register the extensions a path should
            // resolve to; an unregistered path simply yields no extension (a failed load).
            if (this.opts.noExtensions) {
                loaderExtensionsRef.current = { extensions: [], errors: [], runtime: {} };
                return;
            }
            if (this.opts.extensionsOverride) {
                loaderExtensionsRef.current = this.opts.extensionsOverride(
                    loaderExtensionsRef.current,
                );
            }
        }

        getExtensions() {
            return loaderExtensionsRef.current;
        }
    },
    getAgentDir,
    SessionManager: { inMemory: sessionManagerInMemory, create: sessionManagerCreate },
    SettingsManager: { create: settingsManagerCreate },
}));

vi.mock("../agent-types.js", () => ({
    BUILTIN_TOOL_NAMES: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    getConfig: vi.fn(() => ({
        displayName: "Explore",
        description: "Explore",
        builtinToolNames: ["read"],
        extensions: false,
        skills: false,
        promptMode: "replace",
    })),
    getAgentConfig: vi.fn(() => ({
        name: "Explore",
        description: "Explore",
        builtinToolNames: ["read"],
        extensions: false,
        skills: false,
        systemPrompt: "You are Explore.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
        isolated: false,
    })),
    getToolNamesForType: vi.fn(() => ["read"]),
}));

vi.mock("../env.js", () => ({
    detectEnv: vi.fn(async () => ({ isGitRepo: false, branch: "", platform: "linux" })),
}));

vi.mock("../prompts.js", () => ({
    buildAgentPrompt: vi.fn(() => "system prompt"),
}));

import {
    extensionCanonicalName,
    getAgentConversation,
    parseExtensionsSpec,
    parseSubagentMetadata,
    type RunOptions,
    resumeAgent,
    runAgent,
} from "../agent-runner.ts";

type LoaderOptions = {
    noExtensions?: boolean;
    extensionsOverride?: (
        base: typeof loaderExtensionsRef.current,
    ) => typeof loaderExtensionsRef.current;
    additionalExtensionPaths?: string[];
    noSkills?: boolean;
    skillsOverride?: (base: { skills: Array<{ name: string }>; diagnostics: unknown[] }) => {
        skills: Array<{ name: string }>;
        diagnostics: unknown[];
    };
    appendSystemPromptOverride?: (sources: string[]) => string[];
};

type UsageInput = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total: number };
};
type AssistantUsageEvent = Parameters<NonNullable<RunOptions["onAssistantUsage"]>>[0];
type CompactionEvent = Parameters<NonNullable<RunOptions["onCompaction"]>>[0];

function createSession(finalText: string) {
    const listeners: Array<(event: AgentSessionEvent) => void> = [];
    const session = {
        messages: [] as unknown[],
        subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
            listeners.push(listener);
            return () => {};
        }),
        prompt: vi.fn(async () => {
            session.messages.push({
                role: "assistant",
                content: [{ type: "text", text: finalText }],
            });
        }),
        abort: vi.fn(),
        steer: vi.fn(),
        getActiveToolNames: vi.fn(() => ["read"]),
        setActiveToolsByName: vi.fn(),
        setSessionName: vi.fn(),
        bindExtensions: vi.fn(async () => {}),
    };
    return { session, listeners };
}

const ctx = {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent prompt"),
    sessionManager: { getBranch: vi.fn(() => []) },
} as unknown as ExtensionContext;

const pi = {} as unknown as ExtensionAPI;

describe("subagent metadata parsing", () => {
    it("accepts metadata written by the agent runner", () => {
        expect(
            parseSubagentMetadata({
                agentId: "agent-1",
                type: "Explore",
                title: "Explore#agent-1",
                bashGatePolicy: "prompt",
            }),
        ).toEqual({
            agentId: "agent-1",
            type: "Explore",
            title: "Explore#agent-1",
            bashGatePolicy: "prompt",
        });
    });

    it("rejects metadata without required type or title fields", () => {
        expect(parseSubagentMetadata({ title: "Explore#agent-1" })).toBeUndefined();
        expect(parseSubagentMetadata({ type: "Explore" })).toBeUndefined();
    });
});

beforeEach(() => {
    createAgentSession.mockReset();
    defaultResourceLoaderCtor.mockClear();
    getAgentDir.mockClear();
    sessionManagerInMemory.mockClear();
    sessionManagerCreate.mockClear();
    settingsManagerGetSessionDir.mockReset();
    settingsManagerGetSessionDir.mockReturnValue(undefined);
    settingsManagerCreate.mockClear();
    loaderExtensionsRef.current = { extensions: [], errors: [], runtime: {} };
});

describe("agent-runner final output capture", () => {
    it("returns the final assistant text even when no text_delta events were streamed", async () => {
        const { session } = createSession("LOCKED");
        createAgentSession.mockResolvedValue({ session });

        const result = await runAgent(ctx, "Explore", "Say LOCKED", { pi });

        expect(result.responseText).toBe("LOCKED");
    });

    it("binds extensions before prompting", async () => {
        const { session } = createSession("BOUND");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "Say BOUND", { pi });

        expect(session.bindExtensions).toHaveBeenCalledTimes(1);
        expect(session.bindExtensions).toHaveBeenCalledWith(
            expect.objectContaining({ onError: expect.any(Function) }),
        );

        const bindOrder = session.bindExtensions.mock.invocationCallOrder[0]!;
        const promptOrder = session.prompt.mock.invocationCallOrder[0]!;
        expect(bindOrder).toBeLessThan(promptOrder);
    });

    it("passes effective cwd and agentDir to the loader and settings manager", async () => {
        const { session } = createSession("CONFIGURED");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "Say CONFIGURED", { pi, cwd: "/tmp/worktree" });

        expect(getAgentDir).toHaveBeenCalledTimes(1);
        expect(defaultResourceLoaderCtor).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: "/tmp/worktree",
                agentDir: "/mock/agent-dir",
            }),
        );
        expect(settingsManagerCreate).toHaveBeenCalledWith("/tmp/worktree", "/mock/agent-dir");
        expect(sessionManagerInMemory).toHaveBeenCalledWith("/tmp/worktree");
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: "/tmp/worktree",
                agentDir: "/mock/agent-dir",
            }),
        );
    });

    it("suppresses AGENTS.md/CLAUDE.md/APPEND_SYSTEM.md for subagents", async () => {
        const { session } = createSession("ISOLATED");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "Say ISOLATED", { pi });

        // noContextFiles skips AGENTS.md/CLAUDE.md at the loader source;
        // appendSystemPromptOverride suppresses APPEND_SYSTEM.md (no flag equivalent).
        expect(defaultResourceLoaderCtor).toHaveBeenCalledWith(
            expect.objectContaining({
                noContextFiles: true,
                appendSystemPromptOverride: expect.any(Function),
            }),
        );
        // The override returns an empty list so any loaded sources are discarded.
        const ctorArgs = defaultResourceLoaderCtor.mock.calls[0]![0]!;
        expect(ctorArgs.appendSystemPromptOverride(["would-be-loaded"])).toEqual([]);
    });

    it("resumeAgent also falls back to the final assistant message text", async () => {
        const { session } = createSession("RESUMED");

        const result = await resumeAgent(session as unknown as AgentSession, "Continue");

        expect(result).toBe("RESUMED");
    });

    it("sets the agent name as session name before binding extensions", async () => {
        const { session } = createSession("NAMED");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        expect(session.setSessionName).toHaveBeenCalledWith("Explore");
        const setOrder = session.setSessionName.mock.invocationCallOrder[0]!;
        const bindOrder = session.bindExtensions.mock.invocationCallOrder[0]!;
        expect(setOrder).toBeLessThan(bindOrder);
    });

    it("suffixes the session name with a short agentId so parallel spawns are distinguishable", async () => {
        const { session } = createSession("NAMED");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi, agentId: "a1b2c3d4e5f6" });

        expect(session.setSessionName).toHaveBeenCalledWith("Explore#a1b2c3d4");
    });
});

// ─── message_end → onAssistantUsage wiring (issue #38) ─────────────────
// Both runAgent and resumeAgent dispatch usage to the caller via this
// callback. The callback feeds the AgentRecord lifetime accumulator, which
// is the source of truth for total tokens (survives compaction).
describe("agent-runner usage callback wiring", () => {
    function emitMessageEnd(
        listeners: Array<(event: AgentSessionEvent) => void>,
        usage: UsageInput,
    ) {
        const event = {
            type: "message_end",
            message: {
                role: "assistant",
                content: [],
                usage: {
                    input: usage.input ?? 0,
                    output: usage.output ?? 0,
                    cacheRead: usage.cacheRead ?? 0,
                    cacheWrite: usage.cacheWrite ?? 0,
                    cost: usage.cost ?? { total: 0 },
                },
                provider: "",
                model: "",
                timestamp: 0,
            },
        };
        for (const listener of listeners) listener(event as unknown as AgentSessionEvent);
    }

    it("runAgent forwards full usage from message_end events", async () => {
        const { session, listeners } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        const seen: AssistantUsageEvent[] = [];
        session.prompt = vi.fn(async () => {
            // Two assistant messages over the run
            emitMessageEnd(listeners, { input: 100, output: 50, cacheWrite: 10 });
            emitMessageEnd(listeners, { input: 200, output: 80, cacheWrite: 20 });
            session.messages.push({ role: "assistant", content: [{ type: "text", text: "OK" }] });
        });

        await runAgent(ctx, "Explore", "go", {
            pi,
            onAssistantUsage: (u) => seen.push(u),
        });

        expect(seen).toEqual([
            {
                input: 100,
                output: 50,
                cacheRead: 0,
                cacheWrite: 10,
                cost: 0,
                provider: "",
                model: "",
                timestamp: 0,
            },
            {
                input: 200,
                output: 80,
                cacheRead: 0,
                cacheWrite: 20,
                cost: 0,
                provider: "",
                model: "",
                timestamp: 0,
            },
        ]);
    });

    it("runAgent forwards zero-valued usage fields", async () => {
        const { session, listeners } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        const seen: AssistantUsageEvent[] = [];
        session.prompt = vi.fn(async () => {
            emitMessageEnd(listeners, { input: 50 });
            session.messages.push({ role: "assistant", content: [{ type: "text", text: "OK" }] });
        });

        await runAgent(ctx, "Explore", "go", {
            pi,
            onAssistantUsage: (u) => seen.push(u),
        });

        expect(seen).toEqual([
            {
                input: 50,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: 0,
                provider: "",
                model: "",
                timestamp: 0,
            },
        ]);
    });

    it("resumeAgent forwards usage on message_end the same way", async () => {
        const { session, listeners } = createSession("RESUMED");
        const seen: AssistantUsageEvent[] = [];

        session.prompt = vi.fn(async () => {
            emitMessageEnd(listeners, { input: 10, output: 20, cacheWrite: 5 });
            session.messages.push({
                role: "assistant",
                content: [{ type: "text", text: "RESUMED" }],
            });
        });

        await resumeAgent(session as unknown as AgentSession, "continue", {
            onAssistantUsage: (u) => seen.push(u),
        });

        expect(seen).toEqual([
            {
                input: 10,
                output: 20,
                cacheRead: 0,
                cacheWrite: 5,
                cost: 0,
                provider: "",
                model: "",
                timestamp: 0,
            },
        ]);
    });

    it("forwards compaction_end events to onCompaction (only when not aborted)", async () => {
        const { session, listeners } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        const seen: CompactionEvent[] = [];
        session.prompt = vi.fn(async () => {
            // Successful compaction — should fire
            for (const l of listeners)
                l({
                    type: "compaction_end",
                    aborted: false,
                    reason: "threshold",
                    result: { tokensBefore: 12345 },
                } as unknown as AgentSessionEvent);
            // Aborted compaction — should NOT fire
            for (const l of listeners)
                l({
                    type: "compaction_end",
                    aborted: true,
                    reason: "manual",
                    result: { tokensBefore: 99999 },
                } as unknown as AgentSessionEvent);
            session.messages.push({ role: "assistant", content: [{ type: "text", text: "OK" }] });
        });

        await runAgent(ctx, "Explore", "go", {
            pi,
            onCompaction: (info) => seen.push(info),
        });

        expect(seen).toEqual([{ reason: "threshold", tokensBefore: 12345 }]);
    });
});

// getAgentConversation renders the subagent transcript shown in the /agents
// inspect overlay. Pure function over session.messages — no mocks needed
// beyond a literal-object session.
describe("getAgentConversation", () => {
    function fakeSession(messages: unknown[]): AgentSession {
        return { messages } as unknown as AgentSession;
    }

    it("returns an empty string for a session with no messages", () => {
        expect(getAgentConversation(fakeSession([]))).toBe("");
    });

    it("formats a user-then-assistant exchange with role-prefixed lines joined by blank lines", () => {
        const out = getAgentConversation(
            fakeSession([
                { role: "user", content: "hi" },
                { role: "assistant", content: [{ type: "text", text: "hello" }] },
            ]),
        );
        expect(out).toBe("[User]: hi\n\n[Assistant]: hello");
    });

    it("accepts user content as content-blocks (not just strings)", () => {
        const out = getAgentConversation(
            fakeSession([{ role: "user", content: [{ type: "text", text: "from blocks" }] }]),
        );
        expect(out).toBe("[User]: from blocks");
    });

    it("emits a [Tool Calls] block listing each toolCall by name or toolName, falling back to 'unknown'", () => {
        const out = getAgentConversation(
            fakeSession([
                {
                    role: "assistant",
                    content: [
                        { type: "text", text: "calling tools" },
                        { type: "toolCall", name: "search" },
                        { type: "toolCall", toolName: "edit" },
                        { type: "toolCall" },
                    ],
                },
            ]),
        );
        expect(out).toContain("[Assistant]: calling tools");
        expect(out).toContain("[Tool Calls]:\n  Tool: search\n  Tool: edit\n  Tool: unknown");
    });

    it("truncates toolResult content beyond 200 chars and tags it with the tool name", () => {
        const longText = "x".repeat(300);
        const out = getAgentConversation(
            fakeSession([
                {
                    role: "toolResult",
                    toolName: "bash",
                    content: [{ type: "text", text: longText }],
                },
            ]),
        );
        expect(out.startsWith("[Tool Result (bash)]: ")).toBe(true);
        expect(out.endsWith("...")).toBe(true);
        // prefix + 200 chars + "..."
        expect(out.length).toBe("[Tool Result (bash)]: ".length + 200 + 3);
    });

    it("emits [Tool Calls] but no [Assistant] when the assistant only made tool calls", () => {
        const out = getAgentConversation(
            fakeSession([
                { role: "user", content: "do it" },
                { role: "assistant", content: [{ type: "toolCall", name: "search" }] },
            ]),
        );
        expect(out).toContain("[User]: do it");
        expect(out).not.toContain("[Assistant]:");
        expect(out).toContain("[Tool Calls]:\n  Tool: search");
    });
});

// ─── master tool allowlist (issue #47) ──────────────────────────────────
// Tool gating happens at `createAgentSession` time via the `tools:`
// parameter. pi-mono's `allowedToolNames` is the master gate: it controls
// BOTH which tools get registered and which enter the initial active set.
// No post-construction `setActiveToolsByName` filter is needed.

import { getAgentConfig, getConfig, getToolNamesForType } from "../agent-types.ts";

const BUILTINS_7 = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function makeAgentConfig(overrides: Record<string, unknown> = {}) {
    return {
        name: "test-agent",
        description: "Test",
        builtinToolNames: BUILTINS_7,
        extensions: true as boolean | string[],
        skills: false as boolean | string[],
        systemPrompt: "Test.",
        promptMode: "replace" as const,
        inheritContext: false,
        runInBackground: false,
        isolated: false,
        ...overrides,
    };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
        displayName: "test-agent",
        description: "Test",
        builtinToolNames: BUILTINS_7,
        extensions: true as boolean | string[],
        skills: false as boolean | string[],
        promptMode: "replace" as const,
        ...overrides,
    };
}

/** Register extensions for the mock loader, keyed by extension path → tool names. */
function withExtensions(spec: Record<string, string[]>) {
    loaderExtensionsRef.current = {
        extensions: Object.entries(spec).map(([path, tools]) => ({
            path,
            tools: new Map(tools.map((n) => [n, {}])),
        })),
        errors: [],
        runtime: {},
    };
}

function lastToolsPassed(): string[] {
    return createAgentSession.mock.calls[0]![0]!.tools;
}

function lastLoaderOpts(): LoaderOptions {
    return defaultResourceLoaderCtor.mock.calls[0]![0]! as LoaderOptions;
}

describe("agent-runner session persistence", () => {
    it("uses an in-memory session by default", async () => {
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig());
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        expect(sessionManagerInMemory).toHaveBeenCalledWith("/tmp");
        expect(sessionManagerCreate).not.toHaveBeenCalled();
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionManager: expect.objectContaining({ kind: "memory-session-manager" }),
            }),
        );
    });

    it("uses pi's normal persistent session location when persistSession is true", async () => {
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig({ persistSession: true }));
        settingsManagerGetSessionDir.mockReturnValue("/normal/pi/sessions");
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        expect(sessionManagerInMemory).not.toHaveBeenCalled();
        expect(sessionManagerCreate).toHaveBeenCalledWith("/tmp", "/normal/pi/sessions");
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionManager: expect.objectContaining({ kind: "persistent-session-manager" }),
            }),
        );
    });

    it("uses a frontmatter sessionDir when persistSession is true and sessionDir is configured", async () => {
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({
                persistSession: true,
                sessionDir: ".seams/pi-sessions/seam-plan-reviewer",
            }),
        );
        settingsManagerGetSessionDir.mockReturnValue("/normal/pi/sessions");
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi, cwd: "/repo" });

        expect(sessionManagerCreate).toHaveBeenCalledWith(
            "/repo",
            path.resolve("/repo", ".seams/pi-sessions/seam-plan-reviewer"),
        );
    });
});

describe("agent-runner master tool allowlist", () => {
    it("extensions: true with extension tools — all 7 built-ins plus extension tools land in the allowlist", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: true }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig({ extensions: true }));
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({ "/ext/mcp.ts": ["mcp", "mcp_call"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        // Order is not semantically meaningful (pi-mono dedupes via Set);
        // assert membership and exact size instead.
        const tools = lastToolsPassed();
        expect(tools).toHaveLength(BUILTINS_7.length + 2);
        expect(new Set(tools)).toEqual(new Set([...BUILTINS_7, "mcp", "mcp_call"]));
    });

    it("enumerates tools across multiple loaded extensions", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: true }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig({ extensions: true }));
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({ "/ext/a.ts": ["tool_a"], "/ext/b.ts": ["tool_b"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).toContain("tool_a");
        expect(tools).toContain("tool_b");
    });

    it("disallowedTools removes both built-ins and extension tools", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: true }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: true, disallowedTools: ["bash", "mcp"] }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({ "/ext/mcp.ts": ["mcp", "mcp_call"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).not.toContain("bash");
        expect(tools).not.toContain("mcp");
        expect(tools).toContain("mcp_call");
        expect(tools).toContain("read");
    });

    it("EXCLUDED_TOOL_NAMES never reach the allowlist even if an extension registers them", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: true }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig({ extensions: true }));
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({
            "/ext/evil.ts": ["Agent", "get_subagent_result", "steer_subagent", "ok_ext"],
        });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).not.toContain("Agent");
        expect(tools).not.toContain("get_subagent_result");
        expect(tools).not.toContain("steer_subagent");
        expect(tools).toContain("ok_ext");
    });

    it("extensions: false with disallowedTools — denylist applies to built-ins", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: false }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: false, disallowedTools: ["bash"] }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).not.toContain("bash");
        expect(tools).toEqual(BUILTINS_7.filter((t) => t !== "bash"));
    });

    it("does not call setActiveToolsByName post-construction (gating is at construction)", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: true }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: true, disallowedTools: ["bash"] }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({ "/ext/mcp.ts": ["mcp"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        expect(session.setActiveToolsByName).not.toHaveBeenCalled();
    });
});

// ─── extensions: string[] as a loader-level extension filter ────────────
// An array entry is a bare name (filters default-discovered extensions),
// a path (loads that extension fresh), or "*" (keep all defaults).
// Filtering happens at the loader via additionalExtensionPaths +
// extensionsOverride — excluded extensions never bind handlers or register
// tools.

describe("extensionCanonicalName", () => {
    it("strips .ts/.js from a single-file extension basename", () => {
        expect(extensionCanonicalName("/x/foo.ts")).toBe("foo");
        expect(extensionCanonicalName("/x/foo.js")).toBe("foo");
    });
    it("uses the parent directory name for index.{ts,js} extensions", () => {
        expect(extensionCanonicalName("/x/foo/index.ts")).toBe("foo");
        expect(extensionCanonicalName("/x/foo/index.js")).toBe("foo");
    });
    it("lowercases the result for case-insensitive matching", () => {
        expect(extensionCanonicalName("/x/MCP.ts")).toBe("mcp");
        expect(extensionCanonicalName("/x/MyExt.js")).toBe("myext");
        expect(extensionCanonicalName("/x/Foo/index.ts")).toBe("foo");
    });
});

describe("parseExtensionsSpec", () => {
    it("classifies bare entries as names", () => {
        const spec = parseExtensionsSpec(["mcp", "logger"], "/work");
        expect(spec.names).toEqual(new Set(["mcp", "logger"]));
        expect(spec.paths).toEqual([]);
        expect(spec.wildcard).toBe(false);
    });
    it("treats '*' as the wildcard", () => {
        const spec = parseExtensionsSpec(["*"], "/work");
        expect(spec.wildcard).toBe(true);
        expect(spec.names.size).toBe(0);
        expect(spec.paths).toEqual([]);
    });
    it("resolves a relative path against cwd and adds its canonical name", () => {
        const spec = parseExtensionsSpec(["./rel/foo.ts"], "/work");
        expect(spec.paths).toEqual([path.resolve("/work", "./rel/foo.ts")]);
        expect(spec.names).toEqual(new Set(["foo"]));
    });
    it("keeps an absolute path as-is", () => {
        const spec = parseExtensionsSpec(["/abs/bar.ts"], "/work");
        expect(spec.paths).toEqual(["/abs/bar.ts"]);
        expect(spec.names).toEqual(new Set(["bar"]));
    });
    it("expands a leading ~ to the home directory", () => {
        const spec = parseExtensionsSpec(["~/ext/baz.ts"], "/work");
        expect(spec.paths[0]).toBe(`${homedir()}/ext/baz.ts`);
        expect(spec.names).toEqual(new Set(["baz"]));
    });
    it("composes wildcard, names, and paths", () => {
        const spec = parseExtensionsSpec(["*", "mcp", "/abs/foo.ts"], "/work");
        expect(spec.wildcard).toBe(true);
        expect(spec.names).toEqual(new Set(["mcp", "foo"]));
        expect(spec.paths).toEqual(["/abs/foo.ts"]);
    });
    it("lowercases bare-name entries — extension names match case-insensitively", () => {
        const spec = parseExtensionsSpec(["Mcp", "LOGGER"], "/work");
        expect(spec.names).toEqual(new Set(["mcp", "logger"]));
    });
    it("ignores empty entries (defensive — upstream parsers already strip them)", () => {
        const spec = parseExtensionsSpec(["", "mcp", ""], "/work");
        expect(spec.names).toEqual(new Set(["mcp"]));
        expect(spec.wildcard).toBe(false);
    });
});

describe("agent-runner extension allowlist", () => {
    function setupArrayAgent(extensions: string[]) {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(makeAgentConfig({ extensions }));
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
    }

    it("['*'] short-circuits — no extensionsOverride, behaves like extensions: true", async () => {
        setupArrayAgent(["*"]);
        withExtensions({ "/ext/a.ts": ["tool_a"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const opts = lastLoaderOpts();
        expect(opts.extensionsOverride).toBeUndefined();
        expect(opts.additionalExtensionPaths).toBeUndefined();
        expect(lastToolsPassed()).toContain("tool_a");
    });

    it("['mcp'] keeps only the mcp-named extension, drops others", async () => {
        setupArrayAgent(["mcp"]);
        withExtensions({
            "/ext/mcp.ts": ["mcp", "mcp_call"],
            "/ext/other.ts": ["other_tool"],
        });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).toContain("mcp");
        expect(tools).toContain("mcp_call");
        expect(tools).not.toContain("other_tool");
    });

    it("an absolute path is added to additionalExtensionPaths and its extension survives", async () => {
        setupArrayAgent(["/abs/foo.ts"]);
        // Pre-register the path so the mock loader treats it as a successful load.
        withExtensions({ "/abs/foo.ts": ["foo_tool"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        expect(lastLoaderOpts().additionalExtensionPaths).toEqual(["/abs/foo.ts"]);
        expect(lastToolsPassed()).toContain("foo_tool");
    });

    it("['*', path] keeps all defaults plus the extra path", async () => {
        setupArrayAgent(["*", "/abs/foo.ts"]);
        withExtensions({
            "/ext/default.ts": ["default_tool"],
            "/abs/foo.ts": ["foo_tool"],
        });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).toContain("default_tool");
        expect(tools).toContain("foo_tool");
    });

    it("['mcp', path] keeps exactly those two, drops other defaults (no wildcard)", async () => {
        // Changelog: `["mcp", "/abs/foo.ts"]` is *just* those two. Distinct from
        // `['*', path]` (all defaults + path) and `['mcp']` (name only).
        setupArrayAgent(["mcp", "/abs/foo.ts"]);
        withExtensions({
            "/ext/mcp.ts": ["mcp_tool"],
            "/abs/foo.ts": ["foo_tool"],
            "/ext/other.ts": ["other_tool"],
        });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const opts = lastLoaderOpts();
        expect(opts.additionalExtensionPaths).toEqual(["/abs/foo.ts"]);
        // No "*" → the loader override is in force (narrowing, not load-all).
        expect(opts.extensionsOverride).toBeDefined();
        const tools = lastToolsPassed();
        expect(tools).toContain("mcp_tool");
        expect(tools).toContain("foo_tool");
        expect(tools).not.toContain("other_tool");
    });

    it("disallowedTools still applies to tools from an allowlisted extension", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: ["mcp"] }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: ["mcp"], disallowedTools: ["mcp"] }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(BUILTINS_7);
        withExtensions({ "/ext/mcp.ts": ["mcp", "mcp_call"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const tools = lastToolsPassed();
        expect(tools).not.toContain("mcp");
        expect(tools).toContain("mcp_call");
    });

    it("warns but proceeds when a bare name matches no loaded extension", async () => {
        setupArrayAgent(["mcp", "typo"]);
        withExtensions({ "/ext/mcp.ts": ["mcp_tool"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });
        const onToolActivity = vi.fn();

        const result = await runAgent(ctx, "Explore", "go", { pi, onToolActivity });

        expect(result.responseText).toBe("OK");
        expect(onToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: expect.stringContaining('extension-error:extension "typo"'),
            }),
        );
    });

    it("warns but proceeds when a path entry fails to load", async () => {
        setupArrayAgent(["/abs/missing.ts"]);
        // Not pre-registered → the mock loader records a load error; the path's
        // canonical name ("missing") is what the unmatched-name check reports.
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });
        const onToolActivity = vi.fn();

        const result = await runAgent(ctx, "Explore", "go", { pi, onToolActivity });

        expect(result.responseText).toBe("OK");
        expect(onToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: expect.stringContaining('extension-error:extension "missing"'),
            }),
        );
    });

    it("matches `extensions: [Mcp]` against `mcp.ts` (case-insensitive)", async () => {
        setupArrayAgent(["Mcp"]);
        withExtensions({ "/ext/mcp.ts": ["mcp_tool"] });
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });
        const onToolActivity = vi.fn();

        await runAgent(ctx, "Explore", "go", { pi, onToolActivity });

        // No extension-error warning — the name resolved.
        const errorCalls = onToolActivity.mock.calls.filter(
            (c) =>
                typeof c[0]?.toolName === "string" && c[0].toolName.startsWith("extension-error:"),
        );
        expect(errorCalls).toEqual([]);
        expect(lastToolsPassed()).toContain("mcp_tool");
    });
});

// ─── unknown built-in tool names in `tools:` (#75) ──────────────────────
describe("agent-runner skill allowlist", () => {
    it("filters pi's native skill loader by configured name", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(
            makeConfig({ extensions: false, skills: ["review"] }),
        );
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: false, skills: ["review"] }),
        );
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });

        await runAgent(ctx, "Explore", "go", { pi });

        const opts = lastLoaderOpts();
        expect(opts.noSkills).toBe(false);
        expect(
            opts.skillsOverride!({
                skills: [{ name: "review" }, { name: "other" }],
                diagnostics: [],
            }).skills,
        ).toEqual([{ name: "review" }]);
    });
});

describe("agent-runner unknown built-in tools", () => {
    it("emits a tools-error warning for each plain entry not in BUILTIN_TOOL_NAMES", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: false }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({
                extensions: false,
                builtinToolNames: ["read", "reed", "grep", "edt"],
            }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(["read", "reed", "grep", "edt"]);
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });
        const onToolActivity = vi.fn();

        const result = await runAgent(ctx, "Explore", "go", { pi, onToolActivity });

        expect(result.responseText).toBe("OK");
        const errorMessages = onToolActivity.mock.calls
            .map((c) => c[0]?.toolName)
            .filter((n): n is string => typeof n === "string" && n.startsWith("tools-error:"));
        expect(errorMessages).toHaveLength(2);
        expect(errorMessages.some((m) => m.includes('"reed"'))).toBe(true);
        expect(errorMessages.some((m) => m.includes('"edt"'))).toBe(true);
    });

    it("stays quiet when all plain tool names are valid built-ins", async () => {
        vi.mocked(getConfig).mockReturnValueOnce(makeConfig({ extensions: false }));
        vi.mocked(getAgentConfig).mockReturnValueOnce(
            makeAgentConfig({ extensions: false, builtinToolNames: ["read", "grep"] }),
        );
        vi.mocked(getToolNamesForType).mockReturnValueOnce(["read", "grep"]);
        const { session } = createSession("OK");
        createAgentSession.mockResolvedValue({ session });
        const onToolActivity = vi.fn();

        await runAgent(ctx, "Explore", "go", { pi, onToolActivity });

        const errorMessages = onToolActivity.mock.calls
            .map((c) => c[0]?.toolName)
            .filter((n): n is string => typeof n === "string" && n.startsWith("tools-error:"));
        expect(errorMessages).toEqual([]);
    });
});
