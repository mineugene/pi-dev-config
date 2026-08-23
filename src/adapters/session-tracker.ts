import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import type {
    AgentEndEvent,
    ExtensionAPI,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { extractLastAssistantText } from "../domain/messages.ts";
import { needsUserInput } from "../domain/session-needs-input.ts";
import {
    type AgentPaneRecord,
    type AgentPaneState,
    formatSessionSummary,
} from "../domain/session-tracker.ts";
import {
    defaultRoutingModelSetting,
    type PiDevConfig,
    type RoutingModelSetting,
    routingModelId,
} from "../infra/config.ts";
import { TrackerClient } from "../infra/session-tracker/client.ts";
import { createTmux, type PaneMetadata } from "../infra/tmux.ts";

const HEARTBEAT_MS = 10_000;
const STATUS_POLL_MS = 1_000;
const TRACKER_STATUS_KEY = "session-tracker";
const NEXT_SESSION_SHORTCUT = "ctrl+shift+n";
const processGlobal = globalThis as typeof globalThis & {
    __pidevSessionTrackerRuntimeId?: string;
    __pidevSessionTrackerSeq?: number;
};
function processRuntimeId(): string {
    if (processGlobal.__pidevSessionTrackerRuntimeId)
        return processGlobal.__pidevSessionTrackerRuntimeId;
    const runtimeId = randomUUID();
    processGlobal.__pidevSessionTrackerRuntimeId = runtimeId;
    return runtimeId;
}
const PROCESS_RUNTIME_ID = processRuntimeId();
function nextProcessSeq(): number {
    const seq = (processGlobal.__pidevSessionTrackerSeq ?? -1) + 1;
    processGlobal.__pidevSessionTrackerSeq = seq;
    return seq;
}

type TrackerClientLike = Pick<
    TrackerClient,
    "focusNext" | "focusPane" | "heartbeat" | "release" | "report" | "snapshot"
>;
type TrackerTmux = {
    clearPaneMetadata(paneId: string, runtimeId: string): Promise<boolean>;
    currentClient(): Promise<string | undefined>;
    setPaneMetadata(paneId: string, metadata: PaneMetadata): Promise<void>;
};

interface SessionTrackerDependencies {
    classifyNeedsInput?: (text: string | undefined, ctx: ExtensionContext) => Promise<boolean>;
    client?: TrackerClientLike;
    configRef?: { current: PiDevConfig };
    paneId?: string;
    runtimeId?: () => string;
    tmux?: TrackerTmux;
    now?: () => number;
    nextSeq?: () => number;
}

function metadata(record: AgentPaneRecord): PaneMetadata {
    return {
        runtimeId: record.runtimeId,
        cwd: record.cwd,
        state: record.state,
        ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
        ...(record.title === undefined ? {} : { title: record.title }),
        ...(record.role === undefined ? {} : { role: record.role }),
        ...(record.group === undefined ? {} : { group: record.group }),
        ...(record.parentPaneId === undefined ? {} : { parentPaneId: record.parentPaneId }),
    };
}

function classifierModel(setting: RoutingModelSetting | undefined, ctx: ExtensionContext) {
    const configured = routingModelId(setting);
    if (!configured) return undefined;
    const slash = configured.indexOf("/");
    const available = ctx.modelRegistry.getAvailable();
    if (slash >= 0) {
        const provider = configured.slice(0, slash).toLowerCase();
        const id = configured.slice(slash + 1).toLowerCase();
        return available.find(
            (model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id,
        );
    }
    const matches = available.filter(
        (model) => model.id.toLowerCase() === configured.toLowerCase(),
    );
    return matches.length === 1 ? matches[0] : undefined;
}

async function classifyNeedsInputWithModel(
    text: string | undefined,
    ctx: ExtensionContext,
    configRef: { current: PiDevConfig } | undefined,
): Promise<boolean> {
    if (needsUserInput(text)) return true;
    if (!text) return false;
    const setting =
        configRef?.current.sessionTracker?.needsInputModel ??
        defaultRoutingModelSetting(configRef?.current.routing, "fast");
    const model = classifierModel(setting, ctx);
    if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) return false;
    try {
        const response = await ctx.modelRegistry.complete(
            model,
            {
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: [
                                    "Classify the assistant's final response.",
                                    "Return NEEDS_INPUT only when useful work cannot continue without a required user answer, choice, clarification, approval, or review.",
                                    "Return IDLE for completed work, summaries, rhetorical questions, and optional offers.",
                                    "Return exactly NEEDS_INPUT or IDLE.",
                                    "",
                                    "<assistant_response>",
                                    text.slice(-4_000),
                                    "</assistant_response>",
                                ].join("\n"),
                            },
                        ],
                        timestamp: Date.now(),
                    },
                ],
            },
            {
                cacheRetention: "none",
                maxRetries: 0,
                maxTokens: 32,
                sessionId: randomUUID(),
                signal: AbortSignal.timeout(10_000),
                temperature: 0,
                timeoutMs: 10_000,
            },
        );
        const verdict = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
            .trim()
            .toUpperCase();
        return verdict === "NEEDS_INPUT";
    } catch {
        return false;
    }
}

function pickerLabel(record: AgentPaneRecord): string {
    const name = (record.title || basename(record.cwd) || record.cwd)
        .replace(/[\r\n\t]+/gu, " ")
        .trim();
    return `${record.state} · ${name} · ${record.paneId}`;
}

export default function registerSessionTracker(
    pi: ExtensionAPI,
    dependencies: SessionTrackerDependencies = {},
): void {
    const paneId = dependencies.paneId ?? process.env.TMUX_PANE;
    // TODO: Add a Windows tracker transport and terminal endpoint integration.
    if (process.platform === "win32" || !paneId || !/^%\d+$/u.test(paneId)) return;

    const client = dependencies.client ?? new TrackerClient();
    const tmux = dependencies.tmux ?? createTmux();
    const now = dependencies.now ?? Date.now;
    const nextSeq = dependencies.nextSeq ?? nextProcessSeq;
    const runtimeId = dependencies.runtimeId?.() ?? PROCESS_RUNTIME_ID;
    const classifyNeedsInput =
        dependencies.classifyNeedsInput ??
        ((text: string | undefined, ctx: ExtensionContext) =>
            classifyNeedsInputWithModel(text, ctx, dependencies.configRef));

    let currentCtx: ExtensionContext | undefined;
    let currentRecord: AgentPaneRecord | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let statusTimer: ReturnType<typeof setInterval> | undefined;
    let mainWorking = false;
    let needsInput = false;
    let permissionWaits = 0;
    let lastAssistantText: string | undefined;
    let lastStatus: string | undefined;
    let hasReportedStatus = false;
    const backgroundAgents = new Set<string>();

    function derivedState(): AgentPaneState {
        if (permissionWaits > 0) return "needs-permission";
        if (mainWorking || backgroundAgents.size > 0) return "working";
        if (needsInput) return "needs-input";
        return "idle";
    }

    async function updateStatus(ctx = currentCtx): Promise<void> {
        if (!ctx || !paneId) return;
        const records = await client.snapshot();
        const status = records === undefined ? undefined : formatSessionSummary(records);
        if (hasReportedStatus && status === lastStatus) return;
        hasReportedStatus = true;
        lastStatus = status;
        ctx.ui.setStatus(TRACKER_STATUS_KEY, status);
    }

    async function sendRecord(kind: "report" | "heartbeat" = "report"): Promise<void> {
        if (!currentRecord || !paneId) return;
        currentRecord = {
            ...currentRecord,
            state: derivedState(),
            seq: nextSeq(),
            heartbeatAt: now(),
        };
        const sent =
            kind === "heartbeat"
                ? await client.heartbeat(currentRecord)
                : await client.report(currentRecord);
        if (!sent) {
            try {
                await tmux.setPaneMetadata(paneId, metadata(currentRecord));
            } catch {
                // tmux metadata and the tracker are both optional projections.
            }
        }
    }

    async function transition(): Promise<void> {
        const next = derivedState();
        if (currentRecord?.state === next) return;
        await sendRecord();
    }

    async function targetClient(): Promise<string | undefined> {
        try {
            return await tmux.currentClient();
        } catch {
            return undefined;
        }
    }

    async function focusNext(ctx: ExtensionContext): Promise<void> {
        if (!paneId) {
            ctx.ui.notify("Session tracking is available only inside tmux.", "warning");
            return;
        }
        const response = await client.focusNext(paneId, await targetClient());
        if (!response?.ok) {
            ctx.ui.notify(response?.error ?? "Session tracker is unavailable.", "warning");
        }
    }

    pi.on("session_start", async (_event, ctx) => {
        currentCtx = ctx;
        if (ctx.mode !== "tui" || !paneId) return;
        mainWorking = false;
        needsInput = false;
        permissionWaits = 0;
        lastAssistantText = undefined;
        lastStatus = undefined;
        hasReportedStatus = false;
        backgroundAgents.clear();
        const title = pi.getSessionName() ?? process.env.PIDEV_AGENT_TITLE;
        currentRecord = {
            paneId,
            runtimeId,
            sessionId: ctx.sessionManager.getSessionId(),
            cwd: ctx.cwd,
            state: "idle",
            seq: -1,
            heartbeatAt: now(),
            ...(title === undefined ? {} : { title }),
            ...(process.env.PIDEV_AGENT_ROLE === undefined
                ? {}
                : { role: process.env.PIDEV_AGENT_ROLE }),
            ...(process.env.PIDEV_AGENT_GROUP === undefined
                ? {}
                : { group: process.env.PIDEV_AGENT_GROUP }),
            ...(process.env.PIDEV_PARENT_PANE === undefined
                ? {}
                : { parentPaneId: process.env.PIDEV_PARENT_PANE }),
        };
        await sendRecord();
        await updateStatus(ctx);
        heartbeatTimer = setInterval(() => void sendRecord("heartbeat"), HEARTBEAT_MS);
        heartbeatTimer.unref();
        statusTimer = setInterval(() => void updateStatus(), STATUS_POLL_MS);
        statusTimer.unref();
    });

    pi.on("input", async (event) => {
        if (event.source === "extension") return;
        needsInput = false;
        await transition();
    });

    pi.on("agent_start", async () => {
        mainWorking = true;
        needsInput = false;
        lastAssistantText = undefined;
        await transition();
    });

    pi.on("agent_end", (event: AgentEndEvent) => {
        lastAssistantText = extractLastAssistantText(event.messages);
    });

    pi.on("agent_settled", async (_event, ctx) => {
        mainWorking = false;
        needsInput = await classifyNeedsInput(lastAssistantText, ctx);
        await transition();
    });

    const unsubscribers = [
        pi.events.on("pidev:bash_gate", async (data) => {
            if ((data as { requiresHuman?: boolean })?.requiresHuman !== true) return;
            permissionWaits += 1;
            await transition();
        }),
        pi.events.on("pidev:bash_gate_resolved", async (data) => {
            if ((data as { requiresHuman?: boolean })?.requiresHuman !== true) return;
            permissionWaits = Math.max(0, permissionWaits - 1);
            await transition();
        }),
        pi.events.on("subagents:started", async (data) => {
            const id = (data as { id?: unknown })?.id;
            if (typeof id !== "string") return;
            backgroundAgents.add(id);
            await transition();
        }),
        pi.events.on("subagents:completed", async (data) => {
            const id = (data as { id?: unknown })?.id;
            if (typeof id !== "string") return;
            backgroundAgents.delete(id);
            await transition();
        }),
        pi.events.on("subagents:failed", async (data) => {
            const id = (data as { id?: unknown })?.id;
            if (typeof id !== "string") return;
            backgroundAgents.delete(id);
            await transition();
        }),
    ];

    pi.on("session_info_changed", async (event) => {
        if (!currentRecord) return;
        if (event.name === undefined) delete currentRecord.title;
        else currentRecord = { ...currentRecord, title: event.name };
        await sendRecord();
    });

    pi.registerCommand("pi-sessions", {
        description: "List and focus tracked Pi panes",
        handler: async (_args, ctx) => {
            if (!paneId) {
                ctx.ui.notify("Session tracking is available only inside tmux.", "warning");
                return;
            }
            for (;;) {
                const records = await client.snapshot();
                if (records === undefined) {
                    ctx.ui.notify("Session tracker is unavailable.", "warning");
                    return;
                }
                if (records.length === 0) {
                    ctx.ui.notify("No tracked Pi panes.", "info");
                    return;
                }
                const choices = records.map(pickerLabel);
                const selected = await ctx.ui.select("Pi sessions", choices);
                if (!selected) return;
                const record = records[choices.indexOf(selected)];
                if (!record) return;
                const response = await client.focusPane(record.paneId, await targetClient());
                if (response?.ok) return;
                ctx.ui.notify(
                    response?.error ?? "Tracked pane disappeared; refreshing.",
                    "warning",
                );
            }
        },
    });

    pi.registerCommand("next-session", {
        description: "Focus the next tracked Pi pane needing attention",
        handler: async (_args, ctx) => focusNext(ctx),
    });

    pi.registerShortcut(NEXT_SESSION_SHORTCUT, {
        description: "Focus the next tracked Pi pane needing attention",
        handler: focusNext,
    });

    pi.on("session_shutdown", async () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (statusTimer) clearInterval(statusTimer);
        heartbeatTimer = undefined;
        statusTimer = undefined;
        currentCtx?.ui.setStatus(TRACKER_STATUS_KEY, undefined);
        lastStatus = undefined;
        hasReportedStatus = false;
        for (const unsubscribe of unsubscribers) unsubscribe();
        if (paneId && currentRecord) {
            const released = await client.release(paneId, runtimeId);
            if (!released) {
                try {
                    await tmux.clearPaneMetadata(paneId, runtimeId);
                } catch {
                    // The pane may already be gone.
                }
            }
        }
        currentCtx = undefined;
        currentRecord = undefined;
    });
}
