/**
 * agent-manager.ts — Tracks agents, background execution, resume support.
 *
 * Background agents are subject to a configurable concurrency limit (default: 4).
 * Excess agents are queued and auto-started as running agents complete.
 * Foreground agents bypass the queue (they block the parent anyway).
 */

import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resumeAgent, runAgent, type ToolActivity } from "./agent-runner.ts";
import type {
    AgentInvocation,
    AgentRecord,
    IsolationMode,
    SubagentType,
    ThinkingLevel,
} from "./types.ts";
import { type AssistantUsage, addUsage, appendSubagentUsageRecord } from "./usage.ts";
import { cleanupWorktree, createWorktree, pruneWorktrees } from "./worktree.ts";

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;
export type OnAgentCompact = (record: AgentRecord, info: CompactionInfo) => void;
export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };

/** Default max concurrent background agents. */
const DEFAULT_MAX_CONCURRENT = 4;

interface SpawnArgs {
    pi: ExtensionAPI;
    ctx: ExtensionContext;
    type: SubagentType;
    prompt: string;
    options: SpawnOptions;
}

export interface SpawnOptions {
    description: string;
    model?: Model<Api>;
    isolated?: boolean;
    inheritContext?: boolean;
    thinkingLevel?: ThinkingLevel;
    isBackground?: boolean;
    /** Isolation mode — "worktree" creates a temp git worktree for the agent. */
    isolation?: IsolationMode;
    /** Resolved invocation snapshot captured for UI display. */
    invocation?: AgentInvocation;
    /** Parent abort signal — when aborted, the subagent is also stopped. */
    signal?: AbortSignal;
    /** Called on tool start/end with activity info (for streaming progress to UI). */
    onToolActivity?: (activity: ToolActivity) => void;
    /** Called on streaming text deltas from the assistant response. */
    onTextDelta?: (delta: string, fullText: string) => void;
    /** Called when the agent session is created (for accessing session stats). */
    onSessionCreated?: (session: AgentSession) => void;
    /** Called at the end of each agentic turn with the cumulative count. */
    onTurnEnd?: (turnCount: number) => void;
    /** Called once per assistant message_end with that message's usage delta. */
    onAssistantUsage?: (usage: AssistantUsage) => void;
    /** Called when the session successfully compacts. */
    onCompaction?: (info: CompactionInfo) => void;
}

export class AgentManager {
    private agents = new Map<string, AgentRecord>();
    private cleanupInterval: ReturnType<typeof setInterval>;
    private onComplete?: OnAgentComplete;
    private onStart?: OnAgentStart;
    private onCompact?: OnAgentCompact;
    private maxConcurrent: number;

    /** Queue of background agents waiting to start. */
    private queue: { id: string; args: SpawnArgs }[] = [];
    /** Number of currently running background agents. */
    private runningBackground = 0;

    constructor(
        onComplete?: OnAgentComplete,
        maxConcurrent = DEFAULT_MAX_CONCURRENT,
        onStart?: OnAgentStart,
        onCompact?: OnAgentCompact,
    ) {
        if (onComplete !== undefined) this.onComplete = onComplete;
        if (onStart !== undefined) this.onStart = onStart;
        if (onCompact !== undefined) this.onCompact = onCompact;
        this.maxConcurrent = maxConcurrent;
        // Cleanup completed agents after 10 minutes (but keep sessions for resume)
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
        this.cleanupInterval.unref();
    }

    /** Update the max concurrent background agents limit. */
    setMaxConcurrent(n: number) {
        this.maxConcurrent = Math.max(1, n);
        // Start queued agents if the new limit allows
        this.drainQueue();
    }

    getMaxConcurrent(): number {
        return this.maxConcurrent;
    }

    /**
     * Spawn an agent and return its ID immediately (for background use).
     * If the concurrency limit is reached, the agent is queued.
     */
    spawn(
        pi: ExtensionAPI,
        ctx: ExtensionContext,
        type: SubagentType,
        prompt: string,
        options: SpawnOptions,
    ): string {
        const id = randomUUID().slice(0, 17);
        const abortController = new AbortController();
        const isBackground = options.isBackground === true;
        const record: AgentRecord = {
            id,
            type,
            description: options.description,
            status: isBackground ? "queued" : "running",
            toolUses: 0,
            startedAt: Date.now(),
            abortController,
            lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
            compactionCount: 0,
            isBackground,
            ...(options.invocation !== undefined ? { invocation: options.invocation } : {}),
        };
        this.agents.set(id, record);

        const args: SpawnArgs = { pi, ctx, type, prompt, options };

        if (isBackground && this.runningBackground >= this.maxConcurrent) {
            // Queue it — will be started when a running agent completes
            this.queue.push({ id, args });
            return id;
        }

        // startAgent can throw (e.g. strict worktree-isolation failure) — clean
        // up the record so callers don't see an orphan in `listAgents()`.
        try {
            this.startAgent(id, record, args);
        } catch (err) {
            this.agents.delete(id);
            throw err;
        }
        return id;
    }

    /** Actually start an agent (called immediately or from queue drain). */
    private startAgent(
        id: string,
        record: AgentRecord,
        { pi, ctx, type, prompt, options }: SpawnArgs,
    ) {
        // Worktree isolation: try to create a temporary git worktree. Strict —
        // fail loud if not possible (no silent fallback to main tree). Done
        // BEFORE state mutation so a throw doesn't leave the record half-running.
        if (options.isolation === "worktree") {
            const wt = createWorktree(ctx.cwd, id);
            if (!wt) {
                throw new Error(
                    'Cannot run with isolation: "worktree" — not a git repo, no commits yet, or `git worktree add` failed. ' +
                        "Initialize git and commit at least once, or omit `isolation`.",
                );
            }
            record.worktree = wt;
        }

        record.status = "running";
        record.startedAt = Date.now();
        if (record.isBackground) this.runningBackground++;
        this.onStart?.(record);

        // Wire parent abort signal to stop the subagent when the parent is interrupted
        let detachParentSignal: (() => void) | undefined;
        if (options.signal) {
            const parentSignal = options.signal;
            const onParentAbort = () => this.abort(id);
            parentSignal.addEventListener("abort", onParentAbort, { once: true });
            detachParentSignal = () => parentSignal.removeEventListener("abort", onParentAbort);
        }
        const detach = () => {
            detachParentSignal?.();
            detachParentSignal = undefined;
        };

        const abortController = record.abortController;
        if (!abortController) throw new Error(`Agent ${id} has no abort controller`);
        const promise = runAgent(ctx, type, prompt, {
            pi,
            agentId: id,
            ...(options.model !== undefined ? { model: options.model } : {}),
            ...(options.isolated !== undefined ? { isolated: options.isolated } : {}),
            ...(options.inheritContext !== undefined
                ? { inheritContext: options.inheritContext }
                : {}),
            ...(options.thinkingLevel !== undefined
                ? { thinkingLevel: options.thinkingLevel }
                : {}),
            ...(record.worktree?.path !== undefined ? { cwd: record.worktree.path } : {}),
            signal: abortController.signal,
            onToolActivity: (activity) => {
                if (activity.type === "end") record.toolUses++;
                options.onToolActivity?.(activity);
            },
            ...(options.onTurnEnd !== undefined ? { onTurnEnd: options.onTurnEnd } : {}),
            ...(options.onTextDelta !== undefined ? { onTextDelta: options.onTextDelta } : {}),
            onAssistantUsage: (usage) => {
                addUsage(record.lifetimeUsage, usage);
                const model = options.model;
                appendSubagentUsageRecord({
                    type: "subagent_usage",
                    subagent: type,
                    sessionId: id,
                    timestamp: usage.timestamp ?? Date.now(),
                    provider: usage.provider ?? model?.provider ?? "unknown",
                    model: usage.model ?? model?.id ?? "unknown",
                    usage: {
                        input: usage.input,
                        output: usage.output,
                        cacheRead: usage.cacheRead ?? 0,
                        cacheWrite: usage.cacheWrite,
                        cost: { total: usage.cost ?? 0 },
                    },
                }).catch(() => undefined);
                options.onAssistantUsage?.(usage);
            },
            onCompaction: (info) => {
                record.compactionCount++;
                this.onCompact?.(record, info);
                options.onCompaction?.(info);
            },
            onSessionCreated: (session) => {
                record.session = session;
                // Flush any steers that arrived before the session was ready
                if (record.pendingSteers?.length) {
                    for (const msg of record.pendingSteers) {
                        session.steer(msg).catch(() => {});
                    }
                    record.pendingSteers = undefined;
                }
                options.onSessionCreated?.(session);
            },
        })
            .then(async ({ responseText, session }) => {
                if (record.pendingCancelSteer && record.status !== "stopped") {
                    const message = record.pendingCancelSteer;
                    record.pendingCancelSteer = undefined;
                    record.status = "running";
                    responseText = await resumeAgent(session, message, {
                        onToolActivity: (activity) => {
                            if (activity.type === "end") record.toolUses++;
                            options.onToolActivity?.(activity);
                        },
                        onAssistantUsage: (usage) => {
                            addUsage(record.lifetimeUsage, usage);
                            options.onAssistantUsage?.(usage);
                        },
                        onCompaction: (info) => {
                            record.compactionCount++;
                            this.onCompact?.(record, info);
                            options.onCompaction?.(info);
                        },
                    });
                }

                // Don't overwrite status if externally stopped via abort()
                if (record.status !== "stopped") record.status = "completed";
                record.result = responseText;
                record.session = session;
                record.completedAt ??= Date.now();

                detach();

                // Final flush of streaming output file
                if (record.outputCleanup) {
                    try {
                        record.outputCleanup();
                    } catch {
                        /* ignore */
                    }
                    record.outputCleanup = undefined;
                }

                // Clean up worktree if used
                if (record.worktree) {
                    const wtResult = cleanupWorktree(ctx.cwd, record.worktree, options.description);
                    record.worktreeResult = wtResult;
                    if (wtResult.hasChanges && wtResult.branch) {
                        record.result =
                            (record.result ?? "") +
                            `\n\n---\nChanges saved to branch \`${wtResult.branch}\`. Merge with: \`git merge ${wtResult.branch}\``;
                    }
                }

                // Fire onComplete for foreground agents too — lifecycle symmetry.
                // Mark resultConsumed so the callback skips notifications (result returned inline).
                if (!record.isBackground) {
                    record.resultConsumed = true;
                    try {
                        this.onComplete?.(record);
                    } catch {
                        /* ignore completion side-effect errors */
                    }
                } else {
                    this.runningBackground--;
                    try {
                        this.onComplete?.(record);
                    } catch {
                        /* ignore completion side-effect errors */
                    }
                    this.drainQueue();
                }
                return responseText;
            })
            .catch((err) => {
                // Don't overwrite status if externally stopped via abort()
                if (record.status !== "stopped") {
                    record.status = "error";
                }
                record.error = err instanceof Error ? err.message : String(err);
                record.completedAt ??= Date.now();

                detach();

                // Final flush of streaming output file on error
                if (record.outputCleanup) {
                    try {
                        record.outputCleanup();
                    } catch {
                        /* ignore */
                    }
                    record.outputCleanup = undefined;
                }

                // Best-effort worktree cleanup on error
                if (record.worktree) {
                    try {
                        const wtResult = cleanupWorktree(
                            ctx.cwd,
                            record.worktree,
                            options.description,
                        );
                        record.worktreeResult = wtResult;
                    } catch {
                        /* ignore cleanup errors */
                    }
                }

                // Fire onComplete for foreground agents too — lifecycle symmetry.
                // Mark resultConsumed so the callback skips notifications (result returned inline).
                if (!record.isBackground) {
                    record.resultConsumed = true;
                    this.onComplete?.(record);
                } else {
                    this.runningBackground--;
                    this.onComplete?.(record);
                    this.drainQueue();
                }
                return "";
            });

        record.promise = promise;

        // Notify caller that spawn is complete (record is in the map, promise is set).
        // Called synchronously — onSessionCreated fires asynchronously inside runAgent.
        // Used by spawnAndWait to let the caller set up output files before streaming starts.
        this.onSpawned?.(id);
    }

    /** Start queued agents up to the concurrency limit. */
    private drainQueue() {
        while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
            const next = this.queue.shift();
            if (!next) break;
            const record = this.agents.get(next.id);
            if (record?.status !== "queued") continue;
            try {
                this.startAgent(next.id, record, next.args);
            } catch (err) {
                // Late failure (e.g. strict worktree-isolation) — surface on the record
                // so the user/agent can see it via /agents, then keep draining.
                record.status = "error";
                record.error = err instanceof Error ? err.message : String(err);
                record.completedAt = Date.now();
                this.onComplete?.(record);
            }
        }
    }

    /**
     * Called synchronously right after spawn, before onSessionCreated fires.
     * Lets the caller set up the output file path on the record.
     * The record is guaranteed to be in this.agents at this point.
     */
    private onSpawned: ((id: string) => void) | undefined;

    /**
     * Spawn an agent and wait for completion (foreground use).
     * Foreground agents bypass the concurrency queue.
     * Returns { id, record } so callers can access the agent ID.
     *
     * @param onSpawned - Called synchronously after spawn(), before onSessionCreated fires.
     *   Use this to set record.outputFile so streamToOutputFile can pick it up.
     */
    async spawnAndWait(
        pi: ExtensionAPI,
        ctx: ExtensionContext,
        type: SubagentType,
        prompt: string,
        options: Omit<SpawnOptions, "isBackground">,
        onSpawned?: (id: string) => void,
    ): Promise<{ id: string; record: AgentRecord }> {
        // Temporarily register the onSpawned hook so startAgent can call it.
        const prevOnSpawned = this.onSpawned;
        this.onSpawned = onSpawned;
        try {
            const id = this.spawn(pi, ctx, type, prompt, { ...options, isBackground: false });
            const record = this.agents.get(id);
            if (!record) throw new Error(`Spawned agent ${id} was not registered`);
            await record.promise;
            return { id, record };
        } finally {
            this.onSpawned = prevOnSpawned;
        }
    }

    /**
     * Resume an existing agent session with a new prompt.
     */
    async resume(
        id: string,
        prompt: string,
        signal?: AbortSignal,
    ): Promise<AgentRecord | undefined> {
        const record = this.agents.get(id);
        if (!record?.session) return undefined;

        record.status = "running";
        record.startedAt = Date.now();
        record.completedAt = undefined;
        record.result = undefined;
        record.error = undefined;

        try {
            const responseText = await resumeAgent(record.session, prompt, {
                onToolActivity: (activity) => {
                    if (activity.type === "end") record.toolUses++;
                },
                onAssistantUsage: (usage) => {
                    addUsage(record.lifetimeUsage, usage);
                },
                onCompaction: (info) => {
                    record.compactionCount++;
                    this.onCompact?.(record, info);
                },
                ...(signal !== undefined ? { signal } : {}),
            });
            record.status = "completed";
            record.result = responseText;
            record.completedAt = Date.now();
        } catch (err) {
            record.status = "error";
            record.error = err instanceof Error ? err.message : String(err);
            record.completedAt = Date.now();
        }

        return record;
    }

    /**
     * Send a steering message to an agent from the UI (mirrors the steer_subagent
     * tool). A live session delivers it now — it interrupts the agent after its
     * current tool execution and appears as a user message. If the session isn't
     * ready yet, the message is queued on `pendingSteers` and flushed when the
     * session is created. Returns false if the agent can't accept steering
     * (unknown id, or no longer running/queued).
     */
    steer(id: string, message: string): boolean {
        const record = this.agents.get(id);
        if (!record) return false;
        if (record.status === "stopped" || record.status === "error") return false;
        if (record.session) {
            if (record.status === "running" && record.session.isStreaming !== false) {
                record.session.steer(message).catch(() => {});
            } else {
                record.status = "running";
                record.completedAt = undefined;
                record.error = undefined;
                resumeAgent(record.session, message, {
                    onToolActivity: (activity) => {
                        if (activity.type === "end") record.toolUses++;
                    },
                    onAssistantUsage: (usage) => addUsage(record.lifetimeUsage, usage),
                    onCompaction: (info) => {
                        record.compactionCount++;
                        this.onCompact?.(record, info);
                    },
                })
                    .then((responseText) => {
                        if (record.status !== "stopped") {
                            record.status = "completed";
                            record.result = responseText;
                            record.completedAt = Date.now();
                            this.onComplete?.(record);
                        }
                    })
                    .catch((err) => {
                        if (record.status !== "stopped") {
                            record.status = "error";
                            record.error = err instanceof Error ? err.message : String(err);
                            record.completedAt = Date.now();
                        }
                    });
            }
        } else if (record.status === "running" || record.status === "queued") {
            if (!record.pendingSteers) record.pendingSteers = [];
            record.pendingSteers.push(message);
        } else {
            return false;
        }
        return true;
    }

    cancelAndSteer(id: string, message: string): boolean {
        const record = this.agents.get(id);
        if (!record?.session || record.status !== "running") return false;
        record.pendingCancelSteer = message;
        record.session.abort().catch(() => {});
        return true;
    }

    getRecord(id: string): AgentRecord | undefined {
        return this.agents.get(id);
    }

    listAgents(): AgentRecord[] {
        return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
    }

    abort(id: string): boolean {
        const record = this.agents.get(id);
        if (!record) return false;

        // Remove from queue if queued
        if (record.status === "queued") {
            this.queue = this.queue.filter((q) => q.id !== id);
            record.status = "stopped";
            record.completedAt = Date.now();
            return true;
        }

        if (record.status !== "running") return false;
        record.abortController?.abort();
        record.status = "stopped";
        record.completedAt = Date.now();
        return true;
    }

    /** Dispose a record's session and remove it from the map. */
    private removeRecord(id: string, record: AgentRecord): void {
        record.session?.dispose();
        record.session = undefined;
        this.agents.delete(id);
    }

    private cleanup() {
        const cutoff = Date.now() - 10 * 60_000;
        for (const [id, record] of this.agents) {
            if (record.status === "running" || record.status === "queued") continue;
            if ((record.completedAt ?? 0) >= cutoff) continue;
            this.removeRecord(id, record);
        }
    }

    /**
     * Remove all completed/stopped/errored records immediately.
     * Called on session start/switch so tasks from a prior session don't persist.
     * Pass skipUnconsumed=true to preserve records the LLM hasn't read yet
     * (resultConsumed=false) — they will be evicted by the 10-minute cleanup timer instead.
     */
    clearCompleted(skipUnconsumed = false): void {
        for (const [id, record] of this.agents) {
            if (record.status === "running" || record.status === "queued") continue;
            if (skipUnconsumed && !record.resultConsumed) continue;
            this.removeRecord(id, record);
        }
    }

    /** Abort all running and queued agents immediately. */
    abortAll(): number {
        let count = 0;
        // Clear queued agents first
        for (const queued of this.queue) {
            const record = this.agents.get(queued.id);
            if (record) {
                record.status = "stopped";
                record.completedAt = Date.now();
                count++;
            }
        }
        this.queue = [];
        // Abort running agents
        for (const record of this.agents.values()) {
            if (record.status === "running") {
                record.abortController?.abort();
                record.status = "stopped";
                record.completedAt = Date.now();
                count++;
            }
        }
        return count;
    }

    dispose() {
        clearInterval(this.cleanupInterval);
        // Clear queue
        this.queue = [];
        for (const record of this.agents.values()) {
            record.session?.dispose();
        }
        this.agents.clear();
        // Prune any orphaned git worktrees (crash recovery)
        try {
            pruneWorktrees(process.cwd());
        } catch {
            /* ignore */
        }
    }
}
