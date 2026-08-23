import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
    type ExtensionAPI,
    getAgentDir,
    type SessionEntry,
    type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import { analyzeBashFacts, type BashFacts, bashGuardDecision } from "../domain/bash.ts";
import {
    authorize,
    authorizeWithSessionGrants,
    isInsideDirectory,
    PERMISSION_MODES,
    type PermissionEffect,
    type PermissionMatcher,
    type PermissionMode,
    type PermissionOperation,
    resolvePermissionPolicy,
    type SessionGrant,
} from "../domain/permissions.ts";
import { extractBashFacts } from "../infra/bash-parser.ts";
import type { PiDevConfig } from "../infra/config.ts";
import { directoryStatus } from "../infra/search-scope.ts";
import { requestSubagentApproval } from "./bash-gate/events.ts";
import { subagentBashGatePolicy, subagentMetadata } from "./bash-gate/subagent.ts";
import {
    classifySecretBashCommand,
    DEFAULT_SECRET_PATTERNS,
    isSecretPath,
} from "./secret-guard.ts";

function pathFromInput(input: Record<string, unknown>): string | undefined {
    return typeof input.path === "string" ? input.path : undefined;
}

function isExternalPath(cwd: string, path: string): boolean {
    if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) return true;
    const fromCwd = relative(resolve(cwd), resolve(cwd, path));
    return fromCwd === ".." || fromCwd.startsWith(`..${sep}`) || isAbsolute(fromCwd);
}

function normalizePathOperation(
    tool: string,
    effect: PermissionEffect,
    input: Record<string, unknown>,
    cwd: string,
    defaultPath?: string,
    secretPatterns: readonly string[] = DEFAULT_SECRET_PATTERNS,
): PermissionOperation {
    const path = pathFromInput(input) ?? defaultPath;
    if (path === undefined) return { tool, effects: new Set(), unknown: true };

    const effects = new Set<PermissionEffect>([effect]);
    const resource = resolve(cwd, path);
    // Reads of harness configuration (skills, prompts, keybindings) are trusted.
    const agentConfig = effect === "read" && isInsideDirectory(resource, getAgentDir());
    if (isExternalPath(cwd, path) && !agentConfig) effects.add("external-path");
    if (isSecretPath(path, secretPatterns)) effects.add("credential");
    return { tool, effects, resource };
}

interface NormalizedToolCall {
    readonly operation: PermissionOperation;
    readonly bashFacts?: BashFacts;
}

function referencesSecretPath(facts: BashFacts, patterns: readonly string[]): boolean {
    return (
        facts.pathCandidates.some((path) => isSecretPath(path, patterns)) ||
        facts.commands.some((command) =>
            command.argv.slice(1).some((argument) => isSecretPath(argument, patterns)),
        )
    );
}

/** Translate supported Pi tool calls into policy operations. */
async function normalizeToolCall(
    event: ToolCallEvent,
    cwd: string,
    extraSecretPatterns: readonly string[] = [],
): Promise<NormalizedToolCall | undefined> {
    const secretPatterns = [...DEFAULT_SECRET_PATTERNS, ...extraSecretPatterns];
    if (event.toolName === "bash") {
        const command = typeof event.input.command === "string" ? event.input.command : undefined;
        if (command === undefined) {
            return { operation: { tool: "bash", effects: new Set(), unknown: true } };
        }

        const facts = await extractBashFacts(command);
        const analysis = analyzeBashFacts(facts);
        const effects = new Set(analysis.effects);
        if (facts.pathCandidates.some((path) => isExternalPath(cwd, path))) {
            effects.add("external-path");
        }
        if (
            classifySecretBashCommand(command, secretPatterns) ||
            referencesSecretPath(facts, secretPatterns)
        ) {
            effects.add("credential");
        }
        return {
            operation: {
                tool: "bash",
                effects,
                command,
                ...(analysis.unknown ? { unknown: true } : {}),
            },
            bashFacts: facts,
        };
    }

    if (event.toolName === "commit") {
        return { operation: { tool: "commit", effects: new Set(["write", "process"]) } };
    }

    if (event.toolName === "powershell") {
        const command = typeof event.input.command === "string" ? event.input.command : undefined;
        return {
            operation: {
                tool: "powershell",
                effects: new Set(["process"]),
                ...(command === undefined ? {} : { command }),
                unknown: true,
            },
        };
    }

    if (event.toolName === "web_search" || event.toolName === "web_read") {
        return { operation: { tool: event.toolName, effects: new Set(["read", "network"]) } };
    }

    if (
        event.toolName === "read" ||
        event.toolName === "write" ||
        event.toolName === "edit" ||
        event.toolName === "grep" ||
        event.toolName === "find" ||
        event.toolName === "ls"
    ) {
        const effect = event.toolName === "write" || event.toolName === "edit" ? "write" : "read";
        const defaultPath =
            event.toolName === "grep" || event.toolName === "find" || event.toolName === "ls"
                ? "."
                : undefined;
        return {
            operation: normalizePathOperation(
                event.toolName,
                effect,
                event.input,
                cwd,
                defaultPath,
                secretPatterns,
            ),
        };
    }
    return undefined;
}

export async function normalizePermissionOperation(
    event: ToolCallEvent,
    cwd: string,
): Promise<PermissionOperation | undefined> {
    return (await normalizeToolCall(event, cwd))?.operation;
}

function formatPermissionRequest(operation: PermissionOperation): string {
    const target = operation.command
        ? operation.command
              .split("\n")
              .map((line, index) => (index === 0 ? `$ ${line}` : `  ${line}`))
              .join("\n")
        : `${operation.tool}${operation.resource ? `: ${operation.resource}` : ""}`;
    const effects = [...operation.effects].sort().join(", ") || "unknown";
    return `Permission required\n\n${target}\n\nEffects: ${effects}.`;
}

/**
 * External file reads grant their containing directory; directory reads grant
 * that directory itself. Unknown target types keep exact-resource grants.
 * Mutations remain exact, and directory grants never match writes or deletes.
 */
function sessionGrantFor(operation: PermissionOperation): SessionGrant {
    const externalRead =
        operation.resource !== undefined &&
        operation.effects.has("external-path") &&
        !operation.effects.has("write") &&
        !operation.effects.has("delete");
    let resourceMatcher: PermissionMatcher = {
        tool: operation.tool,
        ...(operation.resource === undefined ? {} : { resource: operation.resource }),
    };
    if (externalRead && operation.resource !== undefined) {
        const isDirectory = directoryStatus(operation.resource);
        if (isDirectory !== undefined) {
            resourceMatcher = {
                directory: isDirectory ? operation.resource : dirname(operation.resource),
            };
        }
    }
    return {
        decision: "allow",
        matcher: {
            effects: new Set(operation.effects),
            ...resourceMatcher,
            ...(operation.command === undefined ? {} : { command: operation.command }),
            unknown: operation.unknown === true,
        },
    };
}

interface ScopedSessionGrant {
    readonly scope: string;
    readonly grant: SessionGrant;
}

function sessionGrantScope(entries: SessionEntry[]): string | undefined {
    const metadata = subagentMetadata(entries);
    if (metadata === undefined) return "main";
    return metadata?.agentId ? `subagent:${metadata.agentId}` : undefined;
}

const GUARDED_ICON = "\u{f0780}";
const AUTO_ICON = "\u{f0e7}"; // nf-fa-flash
const YOLO_ICON = "\uee15";

const SUBAGENT_DENIED_EFFECTS = new Set<PermissionEffect>([
    "write",
    "delete",
    "external-path",
    "credential",
    "privileged",
]);

function violatesDenyPolicy(operation: PermissionOperation): boolean {
    return (
        operation.unknown === true ||
        [...operation.effects].some((effect) => SUBAGENT_DENIED_EFFECTS.has(effect))
    );
}

export default function registerPermissions(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    pi.registerFlag("yolo", {
        description:
            "Start in the bypass permission profile; Ctrl+Shift+y can still cycle away from it.",
        type: "boolean",
        default: false,
    });

    let grants: ScopedSessionGrant[] = [];
    /** Session mode override; undefined follows the configured permission mode. */
    let modeOverride: PermissionMode | undefined;

    function configuredMode(): PermissionMode {
        return resolvePermissionPolicy(configRef.current.permissions).mode;
    }

    function syncStatus(ctx: { ui: { setStatus(key: string, text: string): void } }): void {
        const mode = modeOverride === "bypass" ? "yolo" : (modeOverride ?? configuredMode());
        const icon =
            mode === "yolo" || mode === "bypass"
                ? YOLO_ICON
                : mode === "auto"
                  ? AUTO_ICON
                  : GUARDED_ICON;
        ctx.ui.setStatus("bash-gate-permissions", `${icon}  permissions: ${mode}`);
    }

    pi.on("session_start", (_event, ctx) => {
        grants = [];
        modeOverride = pi.getFlag("yolo") ? "bypass" : undefined;
        syncStatus(ctx);
    });

    pi.registerShortcut("ctrl+shift+y", {
        description: "Cycle the session permission mode: guarded, auto, yolo",
        handler: (ctx) => {
            const current = modeOverride ?? configuredMode();
            const next =
                PERMISSION_MODES[(PERMISSION_MODES.indexOf(current) + 1) % PERMISSION_MODES.length];
            modeOverride = next;
            syncStatus(ctx);
            ctx.ui.notify(`Permission mode: ${next === "bypass" ? "yolo" : next}.`, "info");
        },
    });

    pi.on("tool_call", async (event, ctx) => {
        const configuredSecretPatterns = configRef.current.secretGuard?.paths;
        const normalized = await normalizeToolCall(
            event,
            ctx.cwd,
            Array.isArray(configuredSecretPatterns)
                ? configuredSecretPatterns.filter((pattern) => typeof pattern === "string")
                : [],
        );
        if (normalized === undefined) return undefined;

        const { operation } = normalized;
        const configuredPolicy = resolvePermissionPolicy(configRef.current.permissions);
        const policy =
            modeOverride === undefined
                ? configuredPolicy
                : { ...configuredPolicy, mode: modeOverride };
        const policyDecision = authorize(operation, policy);
        const bashDecision = normalized.bashFacts
            ? bashGuardDecision(normalized.bashFacts, configRef.current.bashGate?.rules ?? [])
            : "allow";
        if (policyDecision === "deny") {
            return { block: true, reason: "Permissions: operation is denied by policy." };
        }
        if (bashDecision === "deny") {
            return {
                block: true,
                reason: "Permissions: Bash operation is denied by safety policy.",
            };
        }

        const bashWait = normalized.bashFacts
            ? {
                  cwd: ctx.cwd,
                  command: operation.command ?? "",
                  source: operation.unknown ? ("unknown" as const) : ("protected" as const),
                  permissionIds: [],
                  requiresHuman: true,
              }
            : undefined;
        const entries = ctx.sessionManager.getEntries();
        const grantScope = sessionGrantScope(entries);
        const scopedGrants =
            grantScope === undefined
                ? []
                : grants.filter((grant) => grant.scope === grantScope).map((grant) => grant.grant);
        const subagentPolicy = normalized.bashFacts ? subagentBashGatePolicy(entries) : undefined;
        if (subagentPolicy === "deny" && violatesDenyPolicy(operation)) {
            return {
                block: true,
                reason: "Permissions: state-changing or ambiguous Bash is not allowed for this subagent.",
            };
        }

        const decision = authorizeWithSessionGrants(operation, policy, scopedGrants, [
            bashDecision,
        ]);
        if (decision === "allow") return undefined;

        if (normalized.bashFacts) {
            if (subagentPolicy === "deny") {
                return {
                    block: true,
                    reason: "Permissions: approval-required Bash is not allowed for this subagent.",
                };
            }
            if (subagentPolicy === "prompt") {
                const metadata = subagentMetadata(entries);
                if (!metadata?.agentId) {
                    return {
                        block: true,
                        reason: "Permissions: subagent identity is unavailable for approval.",
                    };
                }
                if (bashWait) pi.events.emit("pidev:bash_gate", bashWait);
                try {
                    const approval = await requestSubagentApproval(pi, {
                        agentId: metadata.agentId,
                        title: metadata.title,
                        command: operation.command ?? "",
                        source: operation.unknown ? "unknown" : "protected",
                        permissionIds: [],
                        reasons: [
                            `Effects: ${[...operation.effects].sort().join(", ") || "unknown"}.`,
                        ],
                    });
                    if (approval === "allow-session" && grantScope !== undefined) {
                        grants.push({ scope: grantScope, grant: sessionGrantFor(operation) });
                    }
                    if (approval === "allow" || approval === "allow-session") return undefined;
                    return {
                        block: true,
                        reason: "Permissions: Bash was denied by parent approval.",
                    };
                } finally {
                    if (bashWait) pi.events.emit("pidev:bash_gate_resolved", bashWait);
                }
            }
        }
        if (!ctx.hasUI) {
            return {
                block: true,
                reason: "Permissions: approval is required, but the current run mode cannot prompt.",
            };
        }

        if (bashWait) pi.events.emit("pidev:bash_gate", bashWait);
        try {
            const grant = sessionGrantFor(operation);
            const sessionLabel =
                grant.matcher.directory === undefined
                    ? "Allow for session"
                    : `Allow ${grant.matcher.directory} for session`;
            const choice = await ctx.ui.select(formatPermissionRequest(operation), [
                "Allow once",
                sessionLabel,
                "Deny",
            ]);
            if (choice === "Allow once") return undefined;
            if (choice === sessionLabel) {
                if (grantScope !== undefined) {
                    grants.push({ scope: grantScope, grant });
                }
                return undefined;
            }
            return { block: true, reason: "Permissions: operation was denied by the user." };
        } finally {
            if (bashWait) pi.events.emit("pidev:bash_gate_resolved", bashWait);
        }
    });
}
