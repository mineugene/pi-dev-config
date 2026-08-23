/**
 * agent-runner.ts — Core execution engine: creates sessions, runs agents, collects results.
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
    ExtensionContext,
    LoadExtensionsResult,
    ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import {
    type AgentSession,
    type AgentSessionEvent,
    createAgentSession,
    DefaultResourceLoader,
    type ExtensionAPI,
    getAgentDir,
    SessionManager,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import * as Value from "typebox/value";
import {
    BUILTIN_TOOL_NAMES,
    getAgentConfig,
    getConfig,
    getToolNamesForType,
} from "./agent-types.ts";
import { buildParentContext, extractText } from "./context.ts";
import { DEFAULT_AGENTS } from "./default-agents.ts";
import { detectEnv } from "./env.ts";
import { buildAgentPrompt } from "./prompts.ts";
import { isThinkingLevel, type SubagentType, type ThinkingLevel } from "./types.ts";
import type { AssistantUsage } from "./usage.ts";

/**
 * Tool names registered by THIS extension. Single source of truth so the
 * registration sites (index.ts) and the subagent exclusion list below can't
 * drift apart. These are our own tools, not pi built-ins, so they can't be
 * derived from pi — but they only need defining once.
 */
export const SUBAGENT_TOOL_NAMES = {
    AGENT: "Agent",
    GET_RESULT: "get_subagent_result",
    STEER: "steer_subagent",
} as const;

/** Names of tools registered by this extension that subagents must NOT inherit. */
const EXCLUDED_TOOL_NAMES: string[] = Object.values(SUBAGENT_TOOL_NAMES);

/**
 * Canonical name of an extension for `extensions: [...]` allowlist matching.
 * Lowercased — extension names match case-insensitively so `extensions: [Mcp]`
 * resolves the same as `[mcp]`.
 * Directory extensions (`foo/index.ts`) resolve to the parent directory name;
 * single-file extensions to the basename minus `.ts`/`.js`.
 */
export function extensionCanonicalName(extPath: string): string {
    const base = basename(extPath);
    const name =
        base === "index.ts" || base === "index.js"
            ? basename(dirname(extPath))
            : base.replace(/\.(ts|js)$/, "");
    return name.toLowerCase();
}

/**
 * Classify `extensions: string[]` frontmatter entries for the loader-level filter.
 *
 * An entry is a PATH iff it contains a path separator or starts with `~`; otherwise
 * it is a NAME. `"*"` sets the wildcard flag (keep all default-discovered extensions).
 *
 * Path entries are resolved (`~` expanded, made absolute against `cwd`) into `paths`
 * — and their canonical name is also added to `names`. The loader override matches
 * everything by canonical name, so path-loaded extensions are matched via their name
 * rather than their post-staging `Extension.path`.
 */
export function parseExtensionsSpec(
    entries: string[],
    cwd: string,
): { names: Set<string>; paths: string[]; wildcard: boolean } {
    const names = new Set<string>();
    const paths: string[] = [];
    let wildcard = false;
    for (const entry of entries) {
        if (!entry) continue;
        if (entry === "*") {
            wildcard = true;
            continue;
        }
        const isPathEntry = entry.includes("/") || entry.includes("\\") || entry.startsWith("~");
        if (!isPathEntry) {
            names.add(entry.toLowerCase());
            continue;
        }
        let p = entry;
        if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
            p = homedir() + p.slice(1);
        }
        const abs = isAbsolute(p) ? p : resolve(cwd, p);
        paths.push(abs);
        names.add(extensionCanonicalName(abs));
    }
    return { names, paths, wildcard };
}

/**
 * Try to find the right model for an agent type.
 * Priority: explicit option > config.model > parent model.
 */
function resolveDefaultModel(
    parentModel: Model<Api> | undefined,
    registry: Pick<ModelRegistry, "find" | "getAvailable">,
    configModel?: string,
): Model<Api> | undefined {
    if (configModel) {
        const slashIdx = configModel.indexOf("/");
        if (slashIdx !== -1) {
            const provider = configModel.slice(0, slashIdx);
            const modelId = configModel.slice(slashIdx + 1);

            // Build a set of available model keys for fast lookup
            const availableKeys = new Set(
                registry.getAvailable().map((m) => `${m.provider}/${m.id}`),
            );
            const isAvailable = (p: string, id: string) => availableKeys.has(`${p}/${id}`);

            const found = registry.find(provider, modelId);
            if (found && isAvailable(provider, modelId)) return found;
        }
    }

    return parentModel;
}

/** Info about a tool event in the subagent. */
export interface ToolActivity {
    type: "start" | "end" | "call";
    toolName: string;
    arguments?: Record<string, unknown>;
}

export const SUBAGENT_METADATA_ENTRY = "pi-pidev:subagent";

export const SubagentMetadataSchema = Type.Object({
    agentId: Type.Optional(Type.String()),
    type: Type.String(),
    title: Type.String(),
    bashGatePolicy: Type.Optional(Type.Union([Type.Literal("deny"), Type.Literal("prompt")])),
});

export type SubagentMetadata = Static<typeof SubagentMetadataSchema>;

export function parseSubagentMetadata(value: unknown): SubagentMetadata | undefined {
    return Value.Check(SubagentMetadataSchema, value) ? value : undefined;
}

export interface RunOptions {
    /** ExtensionAPI instance — used for pi.exec() instead of execSync. */
    pi: ExtensionAPI;
    /** Manager-assigned id; suffixes session name to disambiguate parallel spawns (e.g. `Explore#a1b2c3d4`). */
    agentId?: string;
    model?: Model<Api>;
    signal?: AbortSignal;
    isolated?: boolean;
    inheritContext?: boolean;
    thinkingLevel?: ThinkingLevel;
    /** Override working directory (e.g. for worktree isolation). */
    cwd?: string;
    /** Called on tool start/end with activity info. */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Called on streaming text deltas from the assistant response. */
    onTextDelta?: (delta: string, fullText: string) => void;
    onSessionCreated?: (session: AgentSession) => void;
    /** Called at the end of each agentic turn with the cumulative count. */
    onTurnEnd?: (turnCount: number) => void;
    /**
     * Called once per assistant message_end with that message's usage delta.
     * Lets callers maintain a lifetime accumulator that survives compaction
     * (which replaces session.state.messages and resets stats-derived sums).
     */
    onAssistantUsage?: (usage: AssistantUsage) => void;
    /**
     * Called when the session successfully compacts. `tokensBefore` is upstream's
     * pre-compaction context size estimate. Aborted compactions don't fire.
     */
    onCompaction?: (info: {
        reason: "manual" | "threshold" | "overflow";
        tokensBefore: number;
    }) => void;
}

export interface RunResult {
    responseText: string;
    session: AgentSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getAssistantUsage(message: AssistantMessage): AssistantUsage {
    const { usage } = message;
    return {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        cost: usage.cost.total,
        provider: message.provider,
        model: message.model,
        timestamp: message.timestamp,
    };
}

function getToolCallName(value: unknown): string {
    if (!isRecord(value)) return "unknown";
    if (typeof value.name === "string") return value.name;
    return typeof value.toolName === "string" ? value.toolName : "unknown";
}

/**
 * Subscribe to a session and collect the last assistant message text.
 * Returns an object with a `getText()` getter and an `unsubscribe` function.
 */
function collectResponseText(session: AgentSession) {
    let text = "";
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (event.type === "message_start") {
            text = "";
        }
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            text += event.assistantMessageEvent.delta;
        }
    });
    return { getText: () => text, unsubscribe };
}

/** Get the last assistant text from the completed session history. */
function getLastAssistantText(session: AgentSession): string {
    for (let index = session.messages.length - 1; index >= 0; index--) {
        const msg = session.messages[index];
        if (msg?.role !== "assistant") continue;
        const text = extractText(msg.content).trim();
        if (text) return text;
    }
    return "";
}

/**
 * Wire an AbortSignal to abort a session.
 * Returns a cleanup function to remove the listener.
 */
function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
    if (!signal) return () => {};
    const onAbort = () => session.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
}

function resolveConfiguredSessionDir(
    sessionDir: string | undefined,
    cwd: string,
): string | undefined {
    if (!sessionDir) return undefined;
    if (sessionDir === "~" || sessionDir.startsWith("~/"))
        return resolve(homedir(), sessionDir.slice(2));
    if (isAbsolute(sessionDir)) return sessionDir;
    return resolve(cwd, sessionDir);
}

export async function runAgent(
    ctx: ExtensionContext,
    type: SubagentType,
    prompt: string,
    options: RunOptions,
): Promise<RunResult> {
    const config = getConfig(type);
    const agentConfig = getAgentConfig(type);

    // Resolve working directory: worktree override > parent cwd
    const effectiveCwd = options.cwd ?? ctx.cwd;

    const env = await detectEnv(options.pi, effectiveCwd);

    // Get parent system prompt for append-mode agents
    const parentSystemPrompt = ctx.getSystemPrompt();

    // Resolve extensions/skills: isolated overrides to false
    const extensions = options.isolated ? false : config.extensions;
    const skills = options.isolated ? false : config.skills;

    const toolNames = getToolNamesForType(type);

    // Build system prompt from agent config
    let systemPrompt: string;
    if (agentConfig) {
        systemPrompt = buildAgentPrompt(agentConfig, effectiveCwd, env, parentSystemPrompt);
    } else {
        // Unknown type fallback: spread the canonical general config (defensive —
        // unreachable in practice since index.ts resolves unknown types before calling runAgent).
        const fallback = DEFAULT_AGENTS.get("general");
        if (!fallback) throw new Error(`No fallback config available for unknown type "${type}"`);
        systemPrompt = buildAgentPrompt(
            { ...fallback, name: type },
            effectiveCwd,
            env,
            parentSystemPrompt,
        );
    }

    const noSkills = skills === false;

    const agentDir = getAgentDir();

    // Extension loading:
    // - true  → all default-discovered extensions
    // - false → none (noExtensions)
    // - string[] → loader-level allowlist. Bare names keep the matching
    //   default-discovered extension; path entries load that extension fresh;
    //   "*" keeps all default-discovered extensions.
    //
    // Suppress AGENTS.md/CLAUDE.md and APPEND_SYSTEM.md — upstream's
    // buildSystemPrompt() re-appends both AFTER systemPromptOverride, which
    // would defeat prompt_mode: replace and isolated: true. Parent context, if
    // wanted, reaches the subagent via prompt_mode: append (parentSystemPrompt
    // is embedded in systemPromptOverride) or inherit_context (conversation).
    const noExtensions = extensions === false;

    const extensionsSpec = Array.isArray(extensions)
        ? parseExtensionsSpec(extensions, effectiveCwd)
        : undefined;
    const keepNames = extensionsSpec?.names ?? new Set<string>();
    const loadAll = extensions === true || extensionsSpec?.wildcard === true;
    const additionalExtensionPaths = extensionsSpec?.paths.length
        ? extensionsSpec.paths
        : undefined;
    const extensionsOverride: ((base: LoadExtensionsResult) => LoadExtensionsResult) | undefined =
        noExtensions || loadAll
            ? undefined
            : (base) => ({
                  ...base,
                  extensions: base.extensions.filter((e) =>
                      keepNames.has(extensionCanonicalName(e.path)),
                  ),
              });
    const selectedSkills = Array.isArray(skills) ? new Set(skills) : undefined;

    const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] = {
        cwd: effectiveCwd,
        agentDir,
        noExtensions,
        ...(additionalExtensionPaths !== undefined ? { additionalExtensionPaths } : {}),
        ...(extensionsOverride !== undefined ? { extensionsOverride } : {}),
        noSkills,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPromptOverride: () => systemPrompt,
        appendSystemPromptOverride: () => [],
    };
    if (selectedSkills) {
        loaderOptions.skillsOverride = (base) => ({
            ...base,
            skills: base.skills.filter((skill) => selectedSkills.has(skill.name)),
        });
    }
    const loader = new DefaultResourceLoader(loaderOptions);

    const previousSubagentEnv = process.env.PIDEV_SUBAGENT;
    process.env.PIDEV_SUBAGENT = type;
    try {
        await loader.reload();
    } finally {
        if (previousSubagentEnv === undefined) delete process.env.PIDEV_SUBAGENT;
        else process.env.PIDEV_SUBAGENT = previousSubagentEnv;
    }

    // Entries in `tools:` are expected to be built-in names, so an unknown name is
    // unambiguously a typo. Previously this produced a silently broken agent (#75) —
    // pi-mono accepted the bogus name
    // into the allowlist, then dropped it at registration with no signal back.
    if (agentConfig?.builtinToolNames?.length) {
        const knownBuiltins = new Set(BUILTIN_TOOL_NAMES);
        for (const name of agentConfig.builtinToolNames) {
            if (!knownBuiltins.has(name)) {
                options.onToolActivity?.({
                    type: "end",
                    toolName: `tools-error:tool "${name}" requested by agent "${type}" is not a known built-in`,
                });
            }
        }
    }

    // A subagent spawns mid-task, so a bad `extensions:` entry warns rather than aborts.
    if (keepNames.size > 0) {
        const survivingNames = new Set(
            loader.getExtensions().extensions.map((e) => extensionCanonicalName(e.path)),
        );
        for (const name of keepNames) {
            if (!survivingNames.has(name)) {
                options.onToolActivity?.({
                    type: "end",
                    toolName: `extension-error:extension "${name}" requested by agent "${type}" was not loaded`,
                });
            }
        }
    }

    // Resolve model: explicit option > config.model > parent model
    const model =
        options.model ?? resolveDefaultModel(ctx.model, ctx.modelRegistry, agentConfig?.model);

    // Resolve thinking level: explicit option > agent config > undefined (inherit)
    const configuredThinking = options.thinkingLevel ?? agentConfig?.thinking;
    const thinkingLevel = isThinkingLevel(configuredThinking) ? configuredThinking : undefined;

    const disallowedSet = agentConfig?.disallowedTools
        ? new Set(agentConfig.disallowedTools)
        : undefined;

    // Enumerate extension-registered tool names from the loaded resource loader.
    // Extensions populate `extension.tools` during `loader.reload()` and the set
    // is stable afterwards — `bindExtensions` does not register new tools.
    //
    const extensionToolNames: string[] = [];
    if (!noExtensions) {
        for (const extension of loader.getExtensions().extensions) {
            for (const toolName of extension.tools.keys()) {
                extensionToolNames.push(toolName);
            }
        }
    }

    // Build the master tool allowlist applied at session construction.
    // pi-mono's `allowedToolNames` gates BOTH registration and the initial active
    // set, so listing the exact final set here means the session is correctly
    // scoped from the first instant — no post-construction narrowing required.
    const builtinToolNameSet = new Set(toolNames);
    const allowedTools = [...toolNames, ...extensionToolNames].filter((t) => {
        if (EXCLUDED_TOOL_NAMES.includes(t)) return false;
        if (disallowedSet?.has(t)) return false;
        if (builtinToolNameSet.has(t)) return true;
        // Reached only for extension tools. The extension set was already filtered
        // at the loader (extensionsOverride / noExtensions).
        return !noExtensions;
    });

    const settingsManager = SettingsManager.create(effectiveCwd, agentDir);
    const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);
    const defaultSessionDir =
        process.env.PI_CODING_AGENT_SESSION_DIR ?? settingsManager.getSessionDir();
    const sessionManager = agentConfig?.persistSession
        ? SessionManager.create(effectiveCwd, configuredSessionDir ?? defaultSessionDir)
        : SessionManager.inMemory(effectiveCwd);

    // pi 0.80 replaced the modelRegistry session option with modelRuntime. Share
    // the parent's runtime (unwrapped from the ModelRegistry facade) so provider
    // registrations and auth carry into the child; if the private field moves,
    // fall back to the default runtime built from the same agentDir.
    const parentRuntime = (
        ctx.modelRegistry as unknown as {
            runtime?: NonNullable<Parameters<typeof createAgentSession>[0]>["modelRuntime"];
        }
    ).runtime;
    const sessionOpts: NonNullable<Parameters<typeof createAgentSession>[0]> = {
        cwd: effectiveCwd,
        agentDir,
        sessionManager,
        settingsManager,
        ...(model !== undefined ? { model } : {}),
        tools: allowedTools,
        resourceLoader: loader,
    };
    if (parentRuntime) sessionOpts.modelRuntime = parentRuntime;
    if (thinkingLevel) {
        sessionOpts.thinkingLevel = thinkingLevel;
    }

    const { session } = await createAgentSession(sessionOpts);

    sessionManager.appendCustomEntry(SUBAGENT_METADATA_ENTRY, {
        ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        type,
        title: agentConfig?.displayName ?? agentConfig?.name ?? type,
        ...(agentConfig?.bashGatePolicy !== undefined
            ? { bashGatePolicy: agentConfig.bashGatePolicy }
            : {}),
    } satisfies SubagentMetadata);

    const baseSessionName = agentConfig?.name ?? type;
    session.setSessionName(
        options.agentId ? `${baseSessionName}#${options.agentId.slice(0, 8)}` : baseSessionName,
    );

    // Bind extensions so that session_start fires and extensions can initialize
    // (e.g. loading credentials, setting up state). Tool gating already happened
    // at session construction via the `tools:` allowlist above — no separate
    // post-bind filter is needed. All ExtensionBindings fields are optional.
    await session.bindExtensions({
        onError: (err) => {
            options.onToolActivity?.({
                type: "end",
                toolName: `extension-error:${err.extensionPath}`,
            });
        },
    });

    options.onSessionCreated?.(session);

    let turnCount = 0;

    let currentMessageText = "";
    const unsubTurns = session.subscribe((event: AgentSessionEvent) => {
        if (event.type === "turn_end") {
            turnCount++;
            options.onTurnEnd?.(turnCount);
        }
        if (event.type === "message_start") {
            currentMessageText = "";
        }
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            currentMessageText += event.assistantMessageEvent.delta;
            options.onTextDelta?.(event.assistantMessageEvent.delta, currentMessageText);
        }
        if (event.type === "tool_execution_start") {
            options.onToolActivity?.({ type: "start", toolName: event.toolName });
        }
        if (event.type === "tool_execution_end") {
            options.onToolActivity?.({ type: "end", toolName: event.toolName });
        }
        if (event.type === "message_end" && event.message.role === "assistant") {
            for (const part of event.message.content) {
                if (part.type === "toolCall") {
                    options.onToolActivity?.({
                        type: "call",
                        toolName: part.name,
                        arguments: part.arguments,
                    });
                }
            }
            options.onAssistantUsage?.(getAssistantUsage(event.message));
        }
        if (event.type === "compaction_end" && !event.aborted && event.result) {
            options.onCompaction?.({
                reason: event.reason,
                tokensBefore: event.result.tokensBefore,
            });
        }
    });

    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, options.signal);

    // Build the effective prompt: optionally prepend parent context
    let effectivePrompt = prompt;
    if (options.inheritContext) {
        const parentContext = buildParentContext(ctx);
        if (parentContext) {
            effectivePrompt = parentContext + prompt;
        }
    }

    try {
        await session.prompt(effectivePrompt);
    } finally {
        unsubTurns();
        collector.unsubscribe();
        cleanupAbort();
    }

    const responseText = collector.getText().trim() || getLastAssistantText(session);
    return { responseText, session };
}

/**
 * Send a new prompt to an existing session (resume).
 */
export async function resumeAgent(
    session: AgentSession,
    prompt: string,
    options: {
        onToolActivity?: (activity: ToolActivity) => void;
        onAssistantUsage?: (usage: AssistantUsage) => void;
        onCompaction?: (info: {
            reason: "manual" | "threshold" | "overflow";
            tokensBefore: number;
        }) => void;
        signal?: AbortSignal;
    } = {},
): Promise<string> {
    const collector = collectResponseText(session);
    const cleanupAbort = forwardAbortSignal(session, options.signal);

    const unsubEvents =
        options.onToolActivity || options.onAssistantUsage || options.onCompaction
            ? session.subscribe((event: AgentSessionEvent) => {
                  if (event.type === "tool_execution_start")
                      options.onToolActivity?.({ type: "start", toolName: event.toolName });
                  if (event.type === "tool_execution_end")
                      options.onToolActivity?.({ type: "end", toolName: event.toolName });
                  if (event.type === "message_end" && event.message.role === "assistant") {
                      options.onAssistantUsage?.(getAssistantUsage(event.message));
                  }
                  if (event.type === "compaction_end" && !event.aborted && event.result) {
                      options.onCompaction?.({
                          reason: event.reason,
                          tokensBefore: event.result.tokensBefore,
                      });
                  }
              })
            : () => {};

    try {
        await session.prompt(prompt);
    } finally {
        collector.unsubscribe();
        unsubEvents();
        cleanupAbort();
    }

    return collector.getText().trim() || getLastAssistantText(session);
}

/**
 * Send a steering message to a running subagent.
 * The message will interrupt the agent after its current tool execution.
 */
export async function steerAgent(session: AgentSession, message: string): Promise<void> {
    await session.steer(message);
}

/**
 * Get the subagent's conversation messages as formatted text.
 */
export function getAgentConversation(session: AgentSession): string {
    const parts: string[] = [];

    for (const msg of session.messages) {
        if (msg.role === "user") {
            const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
            if (text.trim()) parts.push(`[User]: ${text.trim()}`);
        } else if (msg.role === "assistant") {
            const textParts: string[] = [];
            const toolCalls: string[] = [];
            for (const c of msg.content) {
                if (c.type === "text" && c.text) textParts.push(c.text);
                else if (c.type === "toolCall") toolCalls.push(`  Tool: ${getToolCallName(c)}`);
            }
            if (textParts.length > 0) parts.push(`[Assistant]: ${textParts.join("\n")}`);
            if (toolCalls.length > 0) parts.push(`[Tool Calls]:\n${toolCalls.join("\n")}`);
        } else if (msg.role === "toolResult") {
            const text = extractText(msg.content);
            const truncated = text.length > 200 ? `${text.slice(0, 200)}...` : text;
            parts.push(`[Tool Result (${msg.toolName})]: ${truncated}`);
        }
    }

    return parts.join("\n\n");
}
