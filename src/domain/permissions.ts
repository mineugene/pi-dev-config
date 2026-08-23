export type PermissionDecision = "allow" | "ask" | "deny";

export const PERMISSION_EFFECTS = [
    "read",
    "write",
    "delete",
    "process",
    "network",
    "external-path",
    "credential",
    "privileged",
] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

export const PERMISSION_MODES = ["guarded", "auto", "bypass"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionConfig {
    readonly mode?: PermissionMode;
    readonly effects?: Partial<Record<PermissionEffect, PermissionDecision>>;
}

export interface PermissionOperation {
    readonly tool: string;
    readonly effects: ReadonlySet<PermissionEffect>;
    /** Human-readable target when the operation has one. */
    readonly resource?: string;
    /** Original Bash command when the operation comes from Bash. */
    readonly command?: string;
    /** Classifiers set this for an operation whose effects cannot be trusted. */
    readonly unknown?: boolean;
}

export interface PermissionPolicy {
    readonly mode: PermissionMode;
    readonly effects?: Partial<Record<PermissionEffect, PermissionDecision>>;
}

export function resolvePermissionPolicy(config: PermissionConfig | undefined): PermissionPolicy {
    return {
        mode: config?.mode ?? "auto",
        ...(config?.effects === undefined ? {} : { effects: config.effects }),
    };
}

/** Constraints for a temporary approval. Every declared constraint must match. */
export interface PermissionMatcher {
    readonly tool?: string;
    readonly effects?: ReadonlySet<PermissionEffect>;
    readonly resource?: string;
    /** Granted directory: matches resources inside it, used for session-wide external read grants. */
    readonly directory?: string;
    readonly command?: string;
    readonly unknown?: boolean;
}

export interface SessionGrant {
    readonly matcher: PermissionMatcher;
    readonly decision: "allow";
}

const DEFAULT_DECISIONS: Readonly<
    Record<PermissionMode, Readonly<Record<PermissionEffect, PermissionDecision>>>
> = {
    guarded: {
        read: "allow",
        write: "ask",
        delete: "ask",
        process: "allow",
        network: "ask",
        "external-path": "ask",
        credential: "deny",
        privileged: "deny",
    },
    auto: {
        read: "allow",
        write: "allow",
        delete: "ask",
        process: "allow",
        network: "allow",
        "external-path": "ask",
        credential: "deny",
        privileged: "deny",
    },
    bypass: {
        read: "allow",
        write: "allow",
        delete: "allow",
        process: "allow",
        network: "allow",
        "external-path": "allow",
        credential: "deny",
        privileged: "deny",
    },
};

export function defaultDecisionForEffect(
    mode: PermissionMode,
    effect: PermissionEffect,
): PermissionDecision {
    return DEFAULT_DECISIONS[mode][effect];
}

const DECISION_RANK: Readonly<Record<PermissionDecision, number>> = {
    allow: 0,
    ask: 1,
    deny: 2,
};

export function mostRestrictive(...decisions: readonly PermissionDecision[]): PermissionDecision {
    return decisions.reduce<PermissionDecision>(
        (mostRestrictive, decision) =>
            DECISION_RANK[decision] > DECISION_RANK[mostRestrictive] ? decision : mostRestrictive,
        "allow",
    );
}

/** True when `resource` is `directory` itself or a path beneath it. */
export function isInsideDirectory(resource: string, directory: string): boolean {
    return (
        resource === directory ||
        resource.startsWith(`${directory}/`) ||
        resource.startsWith(`${directory}\\`)
    );
}

function decisionForEffect(policy: PermissionPolicy, effect: PermissionEffect): PermissionDecision {
    return policy.effects?.[effect] ?? defaultDecisionForEffect(policy.mode, effect);
}

function effectDecisionsFor(
    operation: PermissionOperation,
    policy: PermissionPolicy,
): PermissionDecision[] {
    return [...operation.effects].map((effect) => decisionForEffect(policy, effect));
}

const MODE_RANK: Readonly<Record<PermissionMode, number>> = {
    bypass: 0,
    auto: 1,
    guarded: 2,
};

export function mostRestrictiveMode(...modes: readonly PermissionMode[]): PermissionMode {
    return modes.reduce<PermissionMode>(
        (mostRestrictive, mode) =>
            MODE_RANK[mode] > MODE_RANK[mostRestrictive] ? mode : mostRestrictive,
        "bypass",
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPermissionMode(value: unknown): value is PermissionMode {
    return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

function isPermissionEffect(value: string): value is PermissionEffect {
    return (PERMISSION_EFFECTS as readonly string[]).includes(value);
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
    return value === "allow" || value === "ask" || value === "deny";
}

/** Drops malformed permission fields so authorization falls back to the built-in profile. */
export function normalizePermissionConfig(value: unknown): PermissionConfig | undefined {
    if (!isRecord(value)) return undefined;

    const effects: Partial<Record<PermissionEffect, PermissionDecision>> = {};
    if (isRecord(value.effects)) {
        for (const [effect, decision] of Object.entries(value.effects)) {
            if (isPermissionEffect(effect) && isPermissionDecision(decision))
                effects[effect] = decision;
        }
    }

    const mode = isPermissionMode(value.mode) ? value.mode : undefined;
    return mode === undefined && Object.keys(effects).length === 0
        ? undefined
        : {
              ...(mode === undefined ? {} : { mode }),
              ...(Object.keys(effects).length === 0 ? {} : { effects }),
          };
}

/**
 * Combine global and project policies without letting a project weaken a
 * decision declared by the global mode or an effect override.
 */
export function mergePermissionConfigs(
    global: PermissionConfig | undefined,
    project: PermissionConfig | undefined,
): PermissionConfig | undefined {
    if (global === undefined) return project;
    if (project === undefined) return global;

    const mode =
        global.mode && project.mode
            ? mostRestrictiveMode(global.mode, project.mode)
            : (project.mode ?? global.mode);
    const effects: Partial<Record<PermissionEffect, PermissionDecision>> = {};
    for (const effect of PERMISSION_EFFECTS) {
        if (global.effects?.[effect] === undefined && project.effects?.[effect] === undefined) {
            continue;
        }
        const globalDecision =
            global.effects?.[effect] ??
            (global.mode ? defaultDecisionForEffect(global.mode, effect) : undefined);
        const projectDecision =
            project.effects?.[effect] ??
            (project.mode ? defaultDecisionForEffect(project.mode, effect) : undefined);
        const decision =
            globalDecision && projectDecision
                ? mostRestrictive(globalDecision, projectDecision)
                : (projectDecision ?? globalDecision);
        if (decision !== undefined) effects[effect] = decision;
    }

    return {
        ...(mode === undefined ? {} : { mode }),
        ...(Object.keys(effects).length === 0 ? {} : { effects }),
    };
}

/** Hard safety invariants are not configurable, including in bypass mode. */
export function hardDecisionFor(operation: PermissionOperation): PermissionDecision {
    return operation.effects.has("credential") || operation.effects.has("privileged")
        ? "deny"
        : "allow";
}

/** Evaluate a normalized operation against a policy without runtime or UI state. */
export function authorize(
    operation: PermissionOperation,
    policy: PermissionPolicy,
): PermissionDecision {
    const effectDecisions = effectDecisionsFor(operation, policy);
    const networkWrite =
        policy.mode !== "bypass" &&
        operation.effects.has("network") &&
        operation.effects.has("write")
            ? "ask"
            : "allow";

    return mostRestrictive(
        hardDecisionFor(operation),
        operation.unknown === true ? "ask" : "allow",
        networkWrite,
        ...effectDecisions,
    );
}

function sameEffects(
    left: ReadonlySet<PermissionEffect>,
    right: ReadonlySet<PermissionEffect>,
): boolean {
    return left.size === right.size && [...left].every((effect) => right.has(effect));
}

export function matchesPermissionOperation(
    operation: PermissionOperation,
    matcher: PermissionMatcher,
): boolean {
    return (
        (matcher.tool === undefined || matcher.tool === operation.tool) &&
        (matcher.effects === undefined || sameEffects(matcher.effects, operation.effects)) &&
        (matcher.resource === undefined || matcher.resource === operation.resource) &&
        (matcher.directory === undefined ||
            (operation.resource !== undefined &&
                isInsideDirectory(operation.resource, matcher.directory))) &&
        (matcher.command === undefined || matcher.command === operation.command) &&
        (matcher.unknown === undefined || matcher.unknown === (operation.unknown === true))
    );
}

/** A grant can resolve an ask, but never a policy or guard denial. */
export function authorizeWithSessionGrants(
    operation: PermissionOperation,
    policy: PermissionPolicy,
    grants: readonly SessionGrant[],
    guardDecisions: readonly PermissionDecision[] = [],
): PermissionDecision {
    const policyDecision = authorize(operation, policy);
    const guardDecision = mostRestrictive(...guardDecisions);
    if (policyDecision === "deny" || guardDecision === "deny") return "deny";
    // Bypass is a permissive profile: it resolves asks but never a denial.
    if (policy.mode === "bypass") return "allow";
    if (grants.some((grant) => matchesPermissionOperation(operation, grant.matcher)))
        return "allow";
    return mostRestrictive(policyDecision, guardDecision);
}
