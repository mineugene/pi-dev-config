import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentManager } from "./agent-manager.ts";
import { SUBAGENT_TOOL_NAMES } from "./agent-runner.ts";
import { createAgentToolExecute } from "./agent-tool-execute.ts";
import { BUILTIN_TOOL_NAMES, getAgentConfig, getAvailableTypes } from "./agent-types.ts";
import { applyAndEmitLoaded } from "./settings.ts";
import { buildDetails } from "./tool-result.ts";
import type { AgentRecord, JoinMode } from "./types.ts";
import { type AgentActivity, getDisplayName } from "./ui/agent-format.ts";
import { renderAgentToolResult } from "./ui/agent-tool-render.ts";
import type { FleetList } from "./ui/fleet-list.ts";

type RegisterAgentToolDeps = {
    manager: AgentManager;
    agentActivity: Map<string, AgentActivity>;
    fleet: FleetList;
    reloadCustomAgents: () => void;
    isScopeModelsEnabled: () => boolean;
    setDefaultJoinMode: (mode: JoinMode) => void;
    setScopeModelsEnabled: (enabled: boolean) => void;
    setDisableDefaultAgents: (disabled: boolean) => void;
    setFleetViewEnabled: (enabled: boolean) => void;
    getDefaultJoinMode: () => JoinMode;
    trackSpawned: (id: string, joinMode: JoinMode) => void;
    updateHelperToolsActive?: () => void;
};

/** Derive a short model label from a model string. */
export function getModelLabelFromConfig(model: string): string {
    // Strip provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
    const name = model.slice(model.lastIndexOf("/") + 1);
    // Strip trailing date suffix (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
    return name.replace(/-\d{8}$/, "");
}

export function registerAgentTool(pi: ExtensionAPI, deps: RegisterAgentToolDeps) {
    const {
        manager,
        agentActivity,
        fleet,
        reloadCustomAgents,
        isScopeModelsEnabled,
        setDefaultJoinMode,
        setScopeModelsEnabled,
        setDisableDefaultAgents,
        setFleetViewEnabled,
        getDefaultJoinMode,
        trackSpawned,
        updateHelperToolsActive,
    } = deps;
    const terminalRecords = new Map<string, AgentRecord>();
    const rememberTerminalRecord = (event: { id: string }) => {
        const { id } = event;
        if (!id) return;
        const record = manager.getRecord(id);
        if (record) terminalRecords.set(id, record);
    };
    pi.events.on("subagents:completed", (data) => rememberTerminalRecord(data as { id: string }));
    pi.events.on("subagents:failed", (data) => rememberTerminalRecord(data as { id: string }));

    /** Format an agent's built-in tool scope without repeating full schemas. */
    const formatToolsSuffix = (cfg: { builtinToolNames?: string[] } | undefined): string => {
        const tools = cfg?.builtinToolNames;
        if (!tools) return "*";
        if (tools.length === 0) return "none";
        const isFullSet =
            tools.length === BUILTIN_TOOL_NAMES.length &&
            BUILTIN_TOOL_NAMES.every((name) => tools.includes(name));
        return isFullSet ? "*" : tools.join(", ");
    };

    /** First sentence of an agent description — for the compact type list. */
    const firstSentence = (text: string): string => {
        const match = text.match(/^.*?[.!?](?=\s|$)/s);
        return (match ? match[0] : text).replace(/\s+/g, " ").trim();
    };

    /** Compact type list: one line per agent, first sentence only. */
    const buildCompactTypeListText = () =>
        getAvailableTypes()
            .map((name) => {
                const cfg = getAgentConfig(name);
                return `- ${name}: ${firstSentence(cfg?.description ?? name)} (Tools: ${formatToolsSuffix(cfg)})`;
            })
            .join("\n");

    // Apply persisted settings on startup and emit `subagents:settings_loaded`.
    // Global + project merged; missing → defaults; corrupt file emits a warning
    // to stderr and falls back to defaults.
    applyAndEmitLoaded(
        {
            setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
            setDefaultJoinMode,
            setScopeModels: setScopeModelsEnabled,
            setDisableDefaultAgents: setDisableDefaultAgents,
            setFleetView: setFleetViewEnabled,
        },
        (event, payload) => pi.events.emit(event, payload),
    );

    // ---- Agent tool ----

    const agentToolDescription = `Launch an autonomous agent for independent or broad work. Use direct tools for ordinary implementation and do not duplicate delegated work. Types:\n${buildCompactTypeListText()}`;

    const renderMetadata = new Map<string, { model: string; thinking: string }>();

    pi.registerTool(
        defineTool({
            name: SUBAGENT_TOOL_NAMES.AGENT,
            label: "Agent",
            description: agentToolDescription,
            parameters: Type.Object({
                // Put render-critical fields first so streamed tool calls don't briefly
                // display as a generic `Agent(...)` before the subagent type arrives.
                subagent_type: Type.String({
                    description: "Agent type listed above, or a custom agent name.",
                }),
                description: Type.String({
                    description: "A short (3-5 word) description of the task (shown in UI).",
                }),
                prompt: Type.String({
                    description:
                        "A self-contained task; the agent does not see this conversation unless inherit_context is true.",
                }),
                model: Type.Optional(
                    Type.String({
                        description: 'Model override: "provider/modelId" or fuzzy name.',
                    }),
                ),
                thinking: Type.Optional(
                    Type.String({
                        description: "Thinking level: off, minimal, low, medium, high, or xhigh.",
                    }),
                ),
                run_in_background: Type.Optional(
                    Type.Boolean({
                        description:
                            "Set to true to run in background. Returns agent ID immediately. You will be notified on completion.",
                    }),
                ),
                resume: Type.Optional(
                    Type.String({
                        description: "Agent ID whose context should continue.",
                    }),
                ),
                inherit_context: Type.Optional(
                    Type.Boolean({
                        description: "Fork the parent conversation. Default: false.",
                    }),
                ),
                isolation: Type.Optional(
                    Type.Literal("worktree", {
                        description: "Use a temporary git worktree; changes remain on its branch.",
                    }),
                ),
            }),

            // ---- Custom rendering: Claude Code style ----

            renderCall(args, theme, context) {
                const displayName = args.subagent_type
                    ? getDisplayName(args.subagent_type)
                    : "Agent";
                const preview =
                    args.description ||
                    String(args.prompt).replace(/\s+/g, " ").trim().slice(0, 80) ||
                    "no prompt";
                const config = args.subagent_type ? getAgentConfig(args.subagent_type) : undefined;
                const effective = renderMetadata.get(context.toolCallId);
                const model = effective?.model ?? args.model ?? config?.model;
                const thinking = effective?.thinking ?? args.thinking ?? config?.thinking;
                const modelSuffix = [model, thinking && `thinking: ${thinking}`]
                    .filter(Boolean)
                    .join(" · ");
                const suffixes = [
                    modelSuffix || undefined,
                    args.run_in_background ? "background" : undefined,
                ]
                    .filter(Boolean)
                    .map((s) => theme.fg("dim", `: ${s}`))
                    .join("");
                return new Text(
                    theme.fg("toolTitle", theme.bold(displayName)) +
                        theme.fg("dim", `(${preview})`) +
                        suffixes,
                    0,
                    0,
                );
            },

            renderResult(result, options, theme, context) {
                const details = result.details;
                const record = details?.agentId
                    ? (terminalRecords.get(details.agentId) ?? manager.getRecord(details.agentId))
                    : undefined;
                const currentResult =
                    details && record && ["completed", "error", "stopped"].includes(record.status)
                        ? {
                              ...result,
                              details: buildDetails(details, record, agentActivity.get(record.id)),
                          }
                        : result;
                return renderAgentToolResult(currentResult, options, theme, context);
            },
            execute: createAgentToolExecute({
                pi,
                manager,
                agentActivity,
                fleet,
                reloadCustomAgents,
                isScopeModelsEnabled,
                getDefaultJoinMode,
                trackSpawned,
                ...(updateHelperToolsActive !== undefined ? { updateHelperToolsActive } : {}),
                setRenderMetadata: (toolCallId, model, thinking) =>
                    renderMetadata.set(toolCallId, { model, thinking }),
            }),
        }),
    );
}
