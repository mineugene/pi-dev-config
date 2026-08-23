/**
 * Bash Gate Extension
 *
 * Allows routine developer commands and prompts before protected or unknown
 * shell operations. Protected rules always override allow rules. Additional
 * project rules can be added via pidev.json:
 *
 * ```json
 * {
 *   "bashGate": {
 *     "rules": [
 *       { "cmd": "bun", "subcommands": ["test"] },
 *       { "redirects": "any-write" }
 *     ]
 *   }
 * }
 * ```
 *
 * Press Ctrl+Shift+Y to toggle the gate for the main agent. Pass `--yolo` on
 * the CLI to bypass all gates entirely; useful for non-interactive / scripted
 * runs where no UI is available:
 *
 * ```bash
 * pi --yolo -p "run the tests"
 * ```
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
    authorizeBashFacts,
    type BashAuthorization,
    type BashGateConfig,
    type BashGateMatch,
    type BashGateRule,
    DEFAULT_BASH_ALLOW_RULES,
    DEFAULT_BASH_PROTECTED_RULES,
    matchRules,
} from "../../domain/bash.ts";
import { extractBashFacts } from "../../infra/bash-parser.ts";
import type { PiDevConfig } from "../../infra/config.ts";
import {
    parseSubagentMetadata,
    SUBAGENT_METADATA_ENTRY,
    type SubagentMetadata,
} from "../subagents/agent-runner.ts";
import { formatPermissionPrompt, requestSubagentApproval } from "./events.ts";

export type { ApprovalRequest } from "./events.ts";

type BashGatePolicy = "deny" | "prompt";

const GUARDED_ICON = "\u{f0780}";
const YOLO_ICON = "\uee15";

function subagentMetadata(entries: SessionEntry[]): SubagentMetadata | null | undefined {
    const entry = [...entries]
        .reverse()
        .find(
            (candidate) =>
                candidate.type === "custom" && candidate.customType === SUBAGENT_METADATA_ENTRY,
        );
    if (entry?.type !== "custom") return undefined;
    return parseSubagentMetadata(entry.data) ?? null;
}

export function subagentBashGatePolicy(entries: SessionEntry[]): BashGatePolicy | undefined {
    const metadata = subagentMetadata(entries);
    if (metadata === undefined) return undefined;
    if (metadata === null) return "deny";
    const policy = metadata.bashGatePolicy;
    return policy === "deny" || policy === "prompt" ? policy : "deny";
}

/**
 * When a command is approved, add the time spent waiting in the gate to the
 * timeout (if one was set by the model). This is necessary because the TUI
 * elapsed timer starts at `tool_execution_start`, which fires *before* our
 * gate handler runs, so the timer is already counting while the user reads
 * the prompt. The actual process `setTimeout` inside `ops.exec()` only starts
 * after `spawn()`, which is after this handler returns, so the spawned process
 * always gets its full intended timeout. By compensating `event.input.timeout`
 * here we keep the displayed elapsed time consistent with the timeout value.
 */
function compensateTimeout(input: Record<string, unknown>, gateStartMs: number): void {
    if (typeof input.timeout !== "number") return;
    const gateWaitSec = (Date.now() - gateStartMs) / 1000;
    input.timeout = input.timeout + gateWaitSec;
}

function resolveConfiguredRules(config: PiDevConfig): BashGateRule[] {
    return config.bashGate?.rules ?? [];
}

export async function findMatchedPatterns(
    command: string,
    rulesOrConfig: BashGateRule[] | BashGateConfig | PiDevConfig = {},
): Promise<BashGateMatch[]> {
    const facts = await extractBashFacts(command);

    const configuredRules = Array.isArray(rulesOrConfig)
        ? rulesOrConfig
        : "rules" in rulesOrConfig
          ? (rulesOrConfig.rules ?? [])
          : "bashGate" in rulesOrConfig
            ? resolveConfiguredRules(rulesOrConfig)
            : [];
    const builtinRules = Array.isArray(rulesOrConfig) ? [] : DEFAULT_BASH_PROTECTED_RULES;

    return matchRules(facts, configuredRules, builtinRules);
}

export async function findMatchedPattern(
    command: string,
    rulesOrConfig: BashGateRule[] | BashGateConfig | PiDevConfig = {},
): Promise<BashGateMatch | undefined> {
    return (await findMatchedPatterns(command, rulesOrConfig))[0];
}

export async function authorizeBashCommand(
    command: string,
    configuredProtectedRules: readonly BashGateRule[] = [],
): Promise<BashAuthorization> {
    return authorizeBashFacts(await extractBashFacts(command), {
        protectedRules: DEFAULT_BASH_PROTECTED_RULES,
        configuredProtectedRules,
        allowRules: DEFAULT_BASH_ALLOW_RULES,
    });
}

function sessionPermissionScope(
    authorization: Extract<BashAuthorization, { decision: "prompt" }>,
): string {
    return JSON.stringify(authorization.scope);
}

export default function registerBashGate(pi: ExtensionAPI, configRef: { current: PiDevConfig }) {
    pi.registerFlag("yolo", {
        description:
            "Bypass all bash-gate confirmations (useful for non-interactive / scripted runs)",
        type: "boolean",
        default: false,
    });

    let configuredRules: BashGateRule[] = [];
    let mainAgentYolo = false;
    const sessionAllowed = new Set<string>();
    const finishedSubagents = new Set<string>();

    function syncPermissionStatus(ctx: ExtensionContext): void {
        ctx.ui.setStatus(
            "bash-gate-permissions",
            mainAgentYolo
                ? `${YOLO_ICON}  permissions: yolo`
                : `${GUARDED_ICON}  permissions: guarded`,
        );
    }

    pi.on("session_start", (_event, ctx) => {
        configuredRules = resolveConfiguredRules(configRef.current);
        mainAgentYolo = false;
        sessionAllowed.clear();
        finishedSubagents.clear();
        syncPermissionStatus(ctx);
    });

    pi.registerShortcut("ctrl+shift+y", {
        description: "Toggle bash-gate yolo mode for the main agent",
        handler: async (ctx) => {
            mainAgentYolo = !mainAgentYolo;
            syncPermissionStatus(ctx);
            ctx.ui.notify(`Bash gate ${mainAgentYolo ? "disabled" : "enabled"}.`, "info");
        },
    });

    function clearSubagentAllowances(eventData: { id: string }): void {
        const agentId = eventData.id;
        finishedSubagents.add(agentId);
        const prefix = `subagent:${agentId}:`;
        for (const key of sessionAllowed) {
            if (key.startsWith(prefix)) sessionAllowed.delete(key);
        }
    }

    pi.events.on("subagents:completed", (data) => clearSubagentAllowances(data as { id: string }));
    pi.events.on("subagents:failed", (data) => clearSubagentAllowances(data as { id: string }));

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "bash") return undefined;

        const { command } = event.input;
        if (typeof command !== "string") return undefined;

        const authorization = await authorizeBashCommand(command, configuredRules);
        if (authorization.decision === "allow") return undefined;

        const permissionScope = sessionPermissionScope(authorization);
        const entries = ctx.sessionManager.getEntries();
        const metadata = subagentMetadata(entries);
        const subagentPolicy = subagentBashGatePolicy(entries);
        const effectiveSessionAllowKey = metadata?.agentId
            ? `subagent:${metadata.agentId}:${permissionScope}`
            : permissionScope;

        // --yolo bypasses enforcement; it does not change policy classification.
        if (pi.getFlag("yolo") || (mainAgentYolo && metadata === undefined)) return undefined;
        if (sessionAllowed.has(effectiveSessionAllowKey)) return undefined;
        if (subagentPolicy === "deny") {
            return {
                block: true,
                reason: "Bash gate: gated command not allowed for this subagent.",
            };
        }

        const permissionIds = [
            ...new Set(authorization.matched.map((match) => match.permissionId)),
        ];
        const eventData = {
            cwd: ctx.cwd,
            command,
            source: authorization.source,
            permissionIds,
            requiresHuman: true,
        };
        if (subagentPolicy === "prompt") {
            if (!metadata?.agentId || finishedSubagents.has(metadata.agentId)) {
                return {
                    block: true,
                    reason: "Bash gate: subagent identity is unavailable or finished.",
                };
            }

            const gateStartMs = Date.now();
            pi.events.emit("pidev:bash_gate", eventData);
            try {
                const decision = await requestSubagentApproval(pi, {
                    agentId: metadata.agentId,
                    title: metadata.title,
                    command,
                    source: authorization.source,
                    permissionIds,
                    reasons: authorization.reasons,
                });
                if (finishedSubagents.has(metadata.agentId)) {
                    return { block: true, reason: "Bash gate: subagent finished before approval." };
                }
                if (decision === "allow-session") sessionAllowed.add(effectiveSessionAllowKey);
                if (decision === "allow" || decision === "allow-session") {
                    compensateTimeout(event.input, gateStartMs);
                    return undefined;
                }
                return { block: true, reason: "Bash gate: command was denied by parent approval." };
            } finally {
                pi.events.emit("pidev:bash_gate_resolved", eventData);
            }
        }

        if (!ctx.hasUI)
            return { block: true, reason: "Bash gate: no UI available for confirmation." };

        const gateStartMs = Date.now();
        pi.events.emit("pidev:bash_gate", eventData);
        try {
            const choice = await ctx.ui.select(
                formatPermissionPrompt(command, authorization.reasons),
                ["Allow once", "Allow similar commands this session", "Deny"],
            );
            if (choice === "Allow similar commands this session")
                sessionAllowed.add(effectiveSessionAllowKey);
            if (choice === "Allow once" || choice === "Allow similar commands this session") {
                compensateTimeout(event.input, gateStartMs);
                return undefined;
            }
            return { block: true, reason: "Bash gate: command was denied by the user." };
        } finally {
            pi.events.emit("pidev:bash_gate_resolved", eventData);
        }
    });
}
