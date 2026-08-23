/**
 * pi-agents — A pi extension providing Claude Code-style autonomous sub-agents.
 *
 * Tools:
 *   Agent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
 *   /agents                 — Interactive agent management menu
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiDevConfig } from "../../infra/config.ts";
import { formatPermissionPrompt, onSubagentApprovalRequest } from "../bash-gate/events.ts";
import { createAgentCompletionHandler } from "./agent-completion.ts";
import { AgentManager } from "./agent-manager.ts";
import { SUBAGENT_TOOL_NAMES } from "./agent-runner.ts";
import { registerAgents, setDefaultsDisabled } from "./agent-types.ts";
import { registerAgentsCommand } from "./agents-command.ts";
import { loadCustomAgents } from "./custom-agents.ts";
import { applyAgentModelOverrides } from "./model-overrides.ts";
import { registerNotificationRenderer } from "./notifications.ts";
import { getModelLabelFromConfig, registerAgentTool } from "./register-agent-tool.ts";
import { registerResultTools } from "./register-result-tools.ts";
import type { JoinMode } from "./types.ts";
import type { AgentActivity } from "./ui/agent-format.ts";
import { ConversationViewer } from "./ui/conversation-viewer.ts";
import { FleetList } from "./ui/fleet-list.ts";

// ---- Shared helpers ----

export default function (pi: ExtensionAPI, configRef: { current: PiDevConfig } = { current: {} }) {
    // ---- Register custom notification renderer ----
    registerNotificationRenderer(pi);

    /** Reload agents from .pi/agents/*.md and merge with defaults (called on init and each Agent invocation). */
    const reloadCustomAgents = () => {
        const userAgents = loadCustomAgents(process.cwd());
        registerAgents(userAgents);
        applyAgentModelOverrides(configRef.current);
    };

    // Initial load
    reloadCustomAgents();

    // ---- Agent activity tracking ----
    const agentActivity = new Map<string, AgentActivity>();

    function hasActionableBackgroundAgent(): boolean {
        return manager
            .listAgents()
            .some(
                (r) =>
                    r.isBackground === true &&
                    (r.status === "running" || r.status === "queued" || !r.resultConsumed),
            );
    }

    function updateHelperToolsActive(): void {
        if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function")
            return;
        const helperTools = [SUBAGENT_TOOL_NAMES.GET_RESULT, SUBAGENT_TOOL_NAMES.STEER];
        if (!hasActionableBackgroundAgent()) return;
        const current = pi.getActiveTools();
        pi.setActiveTools([...new Set([...current, ...helperTools])]);
    }

    let manager: AgentManager;
    let fleet: FleetList;
    const completion = createAgentCompletionHandler({
        pi,
        getRecord: (id) => manager.getRecord(id),
        onAgentFinishedUI: (id) => {
            agentActivity.delete(id);
            fleet.onAgentFinished(id);
        },
        onActionableAgentsChanged: updateHelperToolsActive,
    });

    manager = new AgentManager(
        completion.onAgentComplete,
        undefined,
        (record) => {
            // Emit started event when agent transitions to running (including from queue)
            pi.events.emit("subagents:started", {
                id: record.id,
                type: record.type,
                description: record.description,
            });
        },
        (record, info) => {
            // Emit compacted event when agent's session compacts (preserves count on record).
            pi.events.emit("subagents:compacted", {
                id: record.id,
                type: record.type,
                description: record.description,
                reason: info.reason,
                tokensBefore: info.tokensBefore,
                compactionCount: record.compactionCount,
            });
        },
    );

    let currentCtx: ExtensionContext | undefined;

    pi.on("session_start", async (_event, ctx) => {
        currentCtx = ctx;
        manager.clearCompleted(true);
        updateHelperToolsActive();
    });

    pi.on("session_before_switch", () => {
        manager.clearCompleted(true);
        updateHelperToolsActive();
    });

    const unsubBashGateApproval = onSubagentApprovalRequest(pi, async (request) => {
        const ui = currentCtx?.ui;
        if (!currentCtx?.hasUI || !ui) return "deny";

        if (request.agentId)
            fleet.setWaitingForBashApproval(request.agentId, request.requestId, request.command);
        try {
            const prompt = formatPermissionPrompt(request.command, request.reasons, request.title);
            const allowSession = "Allow similar commands this session";
            for (;;) {
                const record = request.agentId ? manager.getRecord(request.agentId) : undefined;
                const viewConversation = record?.session ? "View conversation" : undefined;
                const choice = await ui.select(prompt, [
                    "Allow once",
                    allowSession,
                    ...(viewConversation ? [viewConversation] : []),
                    "Deny",
                ]);

                if (choice === viewConversation && record?.session) {
                    const session = record.session;
                    await ui.custom<undefined>(
                        (tui, theme, keybindings, done) =>
                            new ConversationViewer(
                                tui,
                                session,
                                record,
                                agentActivity.get(record.id),
                                theme,
                                done,
                                undefined,
                                keybindings,
                            ),
                    );
                    continue;
                }

                return choice === allowSession
                    ? "allow-session"
                    : choice === "Allow once"
                      ? "allow"
                      : "deny";
            }
        } catch {
            return "deny";
        } finally {
            if (request.agentId)
                fleet.setWaitingForBashApproval(request.agentId, request.requestId);
        }
    });

    // On shutdown, abort all agents immediately and clean up.
    // If the session is going down, there's nothing left to consume agent results.
    pi.on("session_shutdown", async () => {
        unsubBashGateApproval();
        currentCtx = undefined;
        manager.abortAll();
        updateHelperToolsActive();
        completion.dispose();
        fleet.dispose();
        manager.dispose();
    });

    // Claude Code-style FleetView: navigable list of main + subagents above the editor.
    fleet = new FleetList(manager, agentActivity);
    // Widget order follows registration order. Re-add FleetView whenever the to-do
    // widget changes so it remains directly below it.
    pi.events.on("pidev:todo_widget_updated", () => fleet.placeAfterTodo());
    let fleetViewEnabled = true;
    function isFleetViewEnabled(): boolean {
        return fleetViewEnabled;
    }
    function setFleetViewEnabled(b: boolean): void {
        fleetViewEnabled = b;
        fleet.setEnabled(b);
    }

    // ---- Join mode configuration ----
    let defaultJoinMode: JoinMode = "smart";
    function getDefaultJoinMode(): JoinMode {
        return defaultJoinMode;
    }
    function setDefaultJoinMode(mode: JoinMode) {
        defaultJoinMode = mode;
    }

    // ---- Scope models configuration ----
    // When enabled, subagent model choices are validated against `enabledModels`
    // from pi's settings — both global `<agentDir>/settings.json` and
    // project-local `<cwd>/.pi/settings.json` (project overrides global).
    // Off by default; opt-in via `/agents → Settings`. See docstring on
    // SubagentsSettings.scopeModels for the hard-error vs warn-and-proceed
    // policy and its rationale.
    let scopeModelsEnabled = false;
    function isScopeModelsEnabled(): boolean {
        return scopeModelsEnabled;
    }
    function setScopeModelsEnabled(enabled: boolean): void {
        scopeModelsEnabled = enabled;
    }

    // ---- Disable default agents configuration ----
    // When enabled, the three hardcoded default agents (general, explore,
    // Plan) are not registered. User-defined agents from .pi/agents/*.md are
    // completely unaffected — only DEFAULT_AGENTS are suppressed.
    // Defaults to false; opt-in via `/agents → Settings` or subagents.json.
    // State lives in agent-types.ts (isDefaultsDisabled) because registerAgents
    // needs it; this wrapper just re-registers after flipping it.
    function setDisableDefaultAgents(b: boolean): void {
        setDefaultsDisabled(b);
        reloadCustomAgents(); // re-register with new setting
    }

    // Grab UI context from first tool execution.
    pi.on("tool_execution_start", async (_event, ctx) => {
        fleet.setUICtx(ctx.ui);
    });

    // ---- Agent tool ----
    registerAgentTool(pi, {
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
        trackSpawned: completion.trackSpawned,
        updateHelperToolsActive,
    });

    // ---- get_subagent_result + steer_subagent tools ----
    registerResultTools(pi, manager, completion.cancelNudge, updateHelperToolsActive);

    // ---- /agents interactive menu ----
    registerAgentsCommand(pi, {
        manager,
        agentActivity,
        reloadCustomAgents,
        getModelLabelFromConfig,
        getDefaultJoinMode,
        setDefaultJoinMode,
        isScopeModelsEnabled,
        setScopeModelsEnabled,
        setDisableDefaultAgents,
        isFleetViewEnabled,
        setFleetViewEnabled,
    });
}
