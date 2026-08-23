import {
    authorizeWithSessionGrants,
    type PermissionDecision,
    type PermissionEffect,
    type PermissionPolicy,
} from "./permissions.ts";

export const PERMISSION_GUIDANCE_START = "<pi-dev-config-permissions>";
export const PERMISSION_GUIDANCE_END = "</pi-dev-config-permissions>";

export interface PermissionGuidanceInput {
    readonly policy: PermissionPolicy;
    readonly activeTools: ReadonlySet<string>;
    readonly configuredBashRestrictions: boolean;
    readonly bashExamples: {
        readonly read: boolean;
        readonly gitAdd: boolean;
        readonly gitRestoreStaged: boolean;
        readonly checks: boolean;
    };
    readonly subagentPolicy?: "deny" | "prompt";
    readonly sessionTempDirectory?: string;
}

const EFFECT_LABELS: Readonly<Record<PermissionEffect, string>> = {
    read: "reads",
    write: "project writes",
    delete: "deletes",
    process: "local commands",
    network: "network access",
    "external-path": "access to external paths",
    credential: "credential operations",
    privileged: "privileged operations",
};

function list(items: readonly string[]): string {
    if (items.length < 2) return items[0] ?? "nothing";
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function capitalize(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function effectDecision(policy: PermissionPolicy, effect: PermissionEffect): PermissionDecision {
    return authorizeWithSessionGrants(
        { tool: "permission-guidance", effects: new Set([effect]) },
        policy,
        [],
    );
}

function policySentence(policy: PermissionPolicy): string {
    const groups: Record<PermissionDecision, string[]> = { allow: [], ask: [], deny: [] };
    for (const effect of Object.keys(EFFECT_LABELS) as PermissionEffect[]) {
        groups[effectDecision(policy, effect)].push(EFFECT_LABELS[effect]);
    }

    const mode = policy.mode === "bypass" ? "bypass (yolo)" : policy.mode;
    const parts = [
        `In ${mode} permission mode, ${list(groups.allow)} can proceed without approval.`,
    ];
    if (groups.ask.length > 0) parts.push(`${capitalize(list(groups.ask))} need approval.`);
    if (groups.deny.length > 0) parts.push(`${capitalize(list(groups.deny))} are denied.`);
    const networkWrite = authorizeWithSessionGrants(
        { tool: "permission-guidance", effects: new Set(["network", "write"]) },
        policy,
        [],
    );
    if (
        networkWrite === "ask" &&
        effectDecision(policy, "network") === "allow" &&
        effectDecision(policy, "write") === "allow"
    ) {
        parts.push("Network writes need approval.");
    }
    return parts.join(" ");
}

function availableOperations(input: PermissionGuidanceInput): string {
    const examples: string[] = [];
    const hasReadTools = ["read", "grep", "find"].some((tool) => input.activeTools.has(tool));
    const hasWriteTools = ["edit", "write"].some((tool) => input.activeTools.has(tool));
    if (hasReadTools) examples.push("dedicated file and search tools");
    if (hasWriteTools && effectDecision(input.policy, "write") === "allow")
        examples.push("dedicated edit and write tools");
    if (input.activeTools.has("bash")) {
        if (input.bashExamples.read) examples.push("known read-only Bash such as `git diff`");
        if (input.bashExamples.gitAdd) examples.push("explicit `git add <paths>`");
        if (input.bashExamples.gitRestoreStaged)
            examples.push("`git restore --staged <paths>` or `git restore -S <paths>`");
        if (input.bashExamples.checks) examples.push("existing project checks");
    }
    const operations =
        examples.length > 0
            ? `Prefer available operations that need no approval, including ${list(examples)}.`
            : "Use only available operations permitted by the current policy.";
    const temp =
        input.sessionTempDirectory === undefined
            ? ""
            : ` Use \`${input.sessionTempDirectory}\` for temporary files; it is treated as session-local.`;
    return `${operations}${temp}`;
}

export function formatPermissionGuidance(input: PermissionGuidanceInput): string {
    const child =
        input.subagentPolicy === "deny"
            ? " This child cannot run state-changing, external-path, credential, privileged, or unknown Bash. Use available non-Bash tools or report the limit."
            : input.subagentPolicy === "prompt"
              ? " This child sends required Bash approvals to its parent."
              : "";
    const configured = input.configuredBashRestrictions
        ? " Configured Bash restrictions still apply."
        : "";

    return [
        PERMISSION_GUIDANCE_START,
        "## Permission guidance",
        `- ${policySentence(input.policy)}${child}`,
        `- ${availableOperations(input)}`,
        `- Before requesting approval for protected or unknown Bash, seek a genuinely lower-effect operation.${configured}`,
        "- After a hard denial, stop pursuing that operation. Report it briefly and wait. Never retry through another spelling, wrapper, or workaround.",
        "- When unsure whether an alternative crosses the same boundary, ask. Explain an alternative only when it changes or limits the requested result.",
        PERMISSION_GUIDANCE_END,
    ].join("\n");
}

export function applyPermissionGuidance(prompt: string, guidance: string): string {
    const start = prompt.indexOf(PERMISSION_GUIDANCE_START);
    const end = prompt.indexOf(PERMISSION_GUIDANCE_END);
    const withoutOld =
        start >= 0 && end >= start
            ? `${prompt.slice(0, start)}${prompt.slice(end + PERMISSION_GUIDANCE_END.length)}`.trim()
            : prompt.trim();
    return `${withoutOld}\n\n${guidance}`;
}
