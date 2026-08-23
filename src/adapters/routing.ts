import { randomUUID } from "node:crypto";

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    buildRoutingRecoveryLadder,
    classifyRoutingFailure,
    classifyRoutingUserSignal,
    initialRoutingState,
    modelKey,
    normalizeFailureThreshold,
    type RoutingModelRole,
    type RoutingRecoveryTarget,
    type RoutingState,
    recordRoutingCorrection,
    recordRoutingFailure,
    routingTargetKey,
    routingTaskComplexity,
} from "../domain/routing.ts";
import type { RoutingTaskMetrics } from "../domain/usage.ts";
import type {
    PiDevConfig,
    RoutingModelSetting,
    RoutingPreset,
    RoutingThinkingLevel,
} from "../infra/config.ts";

const MINUTE_MS = 60_000;
const SHORT_CACHE_TTL_MINUTES = 5;
const ROUTING_PRESET_ENTRY = "pidev:routing-preset";
const ROUTING_TASK_ENTRY = "pidev:routing-task";

const ROUTING_THINKING_LEVELS = new Set<RoutingThinkingLevel>([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]);

interface RoutingTarget {
    model: Model<Api>;
    thinkingLevel?: RoutingThinkingLevel;
    cacheTtlMinutes?: number;
}

interface NormalizedTargetSetting {
    model: string;
    thinkingLevel?: RoutingThinkingLevel;
    cacheTtlMinutes?: number;
}

function normalizeThinkingLevel(value: unknown): RoutingThinkingLevel | undefined {
    return ROUTING_THINKING_LEVELS.has(value as RoutingThinkingLevel)
        ? (value as RoutingThinkingLevel)
        : undefined;
}

function normalizeTargetSetting(
    setting: RoutingModelSetting | undefined,
): NormalizedTargetSetting | undefined {
    if (typeof setting === "string") {
        const model = setting.trim();
        return model ? { model } : undefined;
    }
    if (!setting || typeof setting.model !== "string") return undefined;
    const model = setting.model.trim();
    const thinkingLevel = normalizeThinkingLevel(setting.thinkingLevel);
    const cacheTtlMinutes = normalizeCacheTtlMinutes(setting.cacheTtlMinutes);
    return model
        ? {
              model,
              ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
              ...(cacheTtlMinutes === undefined ? {} : { cacheTtlMinutes }),
          }
        : undefined;
}

function resolveTarget(
    setting: NormalizedTargetSetting | undefined,
    ctx: ExtensionContext,
): RoutingTarget | string | undefined {
    if (!setting) return undefined;
    const available = ctx.modelRegistry.getAvailable();
    const slash = setting.model.indexOf("/");

    if (slash >= 0) {
        const provider = setting.model.slice(0, slash);
        const id = setting.model.slice(slash + 1);
        const model = available.find(
            (candidate) =>
                candidate.provider.toLowerCase() === provider.toLowerCase() &&
                candidate.id.toLowerCase() === id.toLowerCase(),
        );
        return model
            ? {
                  model,
                  ...(setting.thinkingLevel === undefined
                      ? {}
                      : { thinkingLevel: setting.thinkingLevel }),
                  ...(setting.cacheTtlMinutes === undefined
                      ? {}
                      : { cacheTtlMinutes: setting.cacheTtlMinutes }),
              }
            : `Routing model not found or unavailable: ${setting.model}`;
    }

    const matches = available.filter(
        (candidate) => candidate.id.toLowerCase() === setting.model.toLowerCase(),
    );
    const [match] = matches;
    if (matches.length === 1 && match)
        return {
            model: match,
            ...(setting.thinkingLevel === undefined
                ? {}
                : { thinkingLevel: setting.thinkingLevel }),
            ...(setting.cacheTtlMinutes === undefined
                ? {}
                : { cacheTtlMinutes: setting.cacheTtlMinutes }),
        };
    if (matches.length === 0) return `Routing model not found or unavailable: ${setting.model}`;
    return `Routing model id is ambiguous; use provider/id: ${setting.model}`;
}

function restoredPresetName(ctx: ExtensionContext): string | undefined {
    for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
        if (entry.type !== "custom" || entry.customType !== ROUTING_PRESET_ENTRY) continue;
        if (!entry.data || typeof entry.data !== "object") continue;
        const name = (entry.data as { name?: unknown }).name;
        if (typeof name === "string" && name.trim()) return name.trim();
    }
    return undefined;
}

function assistantFailureInput(message: unknown): { stopReason?: string; errorMessage?: string } {
    if (!message || typeof message !== "object") return {};
    const candidate = message as { stopReason?: unknown; errorMessage?: unknown };
    return {
        ...(typeof candidate.stopReason === "string" ? { stopReason: candidate.stopReason } : {}),
        ...(typeof candidate.errorMessage === "string"
            ? { errorMessage: candidate.errorMessage }
            : {}),
    };
}

function toolResultOutput(result: unknown): string {
    if (!result || typeof result !== "object") return "";
    const content = (result as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .map((block) =>
            block &&
            typeof block === "object" &&
            typeof (block as { text?: unknown }).text === "string"
                ? (block as { text: string }).text
                : "",
        )
        .filter(Boolean)
        .join("\n");
}

function toolResultAttemptsRemediation(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const candidate = result as { toolName?: unknown; isError?: unknown };
    return (
        candidate.isError !== true &&
        (candidate.toolName === "edit" || candidate.toolName === "write")
    );
}

function toolResultSignalsDevelopmentSuccess(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const toolName = (result as { toolName?: unknown }).toolName;
    if (toolName !== "bash") return false;
    const output = toolResultOutput(result);
    return /\b(?:pass(?:ed|es)|tests?:?\s*\d+\s+passed|all tests? pass|0 failures?|success(?:ful|fully)?)\b/i.test(
        output,
    );
}

function failureReason(kind: string, signature: string | undefined): string {
    if (kind === "assistant") return "assistant failure";
    if (kind === "context-limit") return "context limit";
    if (signature?.startsWith("tsc:")) return "repeated compiler failure";
    if (signature?.startsWith("test:")) return "repeated test failure";
    if (signature?.startsWith("runtime:")) return "repeated runtime failure";
    return "meaningful failure";
}

function usageNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function assistantUsage(message: unknown): {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    estimatedCost: number;
} {
    if (!message || typeof message !== "object") {
        return {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            estimatedCost: 0,
        };
    }
    const usage = (message as { usage?: unknown }).usage;
    if (!usage || typeof usage !== "object") {
        return {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            estimatedCost: 0,
        };
    }
    const values = usage as {
        input?: unknown;
        output?: unknown;
        reasoning?: unknown;
        reasoningTokens?: unknown;
        cacheRead?: unknown;
        cost?: { total?: unknown };
    };
    return {
        inputTokens: usageNumber(values.input),
        outputTokens: usageNumber(values.output),
        reasoningTokens: usageNumber(values.reasoningTokens ?? values.reasoning),
        cachedInputTokens: usageNumber(values.cacheRead),
        estimatedCost: usageNumber(values.cost?.total),
    };
}

function normalizeCacheTtlMinutes(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function defaultCacheTtlMinutes(target: RoutingTarget): number {
    if (process.env.PI_CACHE_RETENTION !== "long") return SHORT_CACHE_TTL_MINUTES;
    const provider = target.model.provider.toLowerCase();
    if (provider === "openai") return 24 * 60;
    if (provider === "anthropic") return 60;
    return SHORT_CACHE_TTL_MINUTES;
}

function rolePriority(role: RoutingModelRole): number {
    if (role === "fast") return 0;
    if (role === "base") return 1;
    if (role === "escalated") return 2;
    if (role === "deep") return 3;
    return 4;
}

export default function registerRouting(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    let baseTarget: RoutingTarget | undefined;
    let escalatedTarget: RoutingTarget | undefined;
    let baselineTarget: RoutingTarget | undefined;
    let configuredBase = false;
    let fastTarget: RoutingTarget | undefined;
    let deepTarget: RoutingTarget | undefined;
    let recoveryLadder: RoutingRecoveryTarget<RoutingTarget>[] = [];
    let state: RoutingState = initialRoutingState();
    let activeTurnRole: RoutingModelRole = "base";
    let lastTurnRole: RoutingModelRole | undefined;
    let currentModel: Model<Api> | undefined;
    let currentTarget: RoutingTarget | undefined;
    let expectedModelKey: string | undefined;
    let switchInProgress = false;
    let extensionOwnsActiveModel = false;
    let manualModelOverride = false;
    let manualRoleOverride: RoutingModelRole | undefined;
    let subtaskStarted = false;
    let taskCompletePending = false;
    let completionOnlyTurn = false;
    let pendingInputs: Array<{ text: string; hasImages: boolean }> = [];
    let currentPromptHasImages = false;
    let failureThreshold = 2;
    let correctionThreshold = 2;
    let stagnationThreshold = 2;
    let configuredCacheTtlMinutes: number | undefined;
    let presetCacheTtlMinutes: number | undefined;
    let lastModelUse: { key: string; at: number } | undefined;
    let lastRouterDecision: string | undefined;
    let activePresetName: string | undefined;
    let routingConfigured = false;
    let taskMetrics: RoutingTaskMetrics | undefined;

    const warn = (ctx: ExtensionContext, message: string): void => {
        ctx.ui.notify(message, "warning");
    };

    const automaticRoutingPaused = (): boolean =>
        manualModelOverride || manualRoleOverride !== undefined;

    const rebuildRecoveryLadder = (): void => {
        recoveryLadder = buildRoutingRecoveryLadder(baseTarget, escalatedTarget, deepTarget);
    };

    const targetForRole = (
        role: Exclude<RoutingModelRole, "manual">,
    ): RoutingTarget | undefined => {
        if (role === "fast") return fastTarget;
        return recoveryLadder.find((candidate) => candidate.role === role)?.target;
    };

    const targetLabel = (target: RoutingTarget): string =>
        `${target.model.provider}/${target.model.id}`;

    const recordTaskTarget = (
        target: RoutingTarget,
        role: RoutingModelRole,
        automaticRecovery = false,
    ): void => {
        if (!taskMetrics) return;
        const model = targetLabel(target);
        if (!taskMetrics.modelsUsed.includes(model)) taskMetrics.modelsUsed.push(model);
        let modelUsage = taskMetrics.modelUsage;
        if (!modelUsage) {
            modelUsage = [];
            taskMetrics.modelUsage = modelUsage;
        }
        if (!modelUsage.some((usage) => usage.model === model)) {
            modelUsage.push({
                model,
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cachedInputTokens: 0,
                estimatedCost: 0,
            });
        }
        const thinkingLevel = target.thinkingLevel ?? pi.getThinkingLevel();
        if (!taskMetrics.thinkingLevelsUsed.includes(thinkingLevel)) {
            taskMetrics.thinkingLevelsUsed.push(thinkingLevel);
        }
        if (rolePriority(role) > rolePriority(taskMetrics.highestRole)) {
            taskMetrics.highestRole = role;
        }
        if (role === "escalated" && automaticRecovery) taskMetrics.usedEscalated = true;
        if (role === "deep" && automaticRecovery) taskMetrics.usedDeep = true;
    };

    const ensureTaskMetrics = (): RoutingTaskMetrics | undefined => {
        if (taskMetrics) return taskMetrics;
        const target = activeTarget() ?? baseTarget;
        if (!target) return undefined;
        taskMetrics = {
            taskId: randomUUID(),
            preset: activePresetName ?? "default",
            startingRole: activeTurnRole,
            highestRole: activeTurnRole,
            modelsUsed: [],
            thinkingLevelsUsed: [],
            modelUsage: [],
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            estimatedCost: 0,
            assistantFailures: 0,
            infrastructureFailures: 0,
            developmentFailures: 0,
            stagnationEvents: 0,
            correctionCount: 0,
            usedEscalated: false,
            usedDeep: false,
            turns: 0,
            completed: false,
        };
        recordTaskTarget(target, activeTurnRole);
        return taskMetrics;
    };

    const recordTaskUsage = (message: unknown, target: RoutingTarget | undefined): void => {
        const metrics = taskMetrics;
        if (!metrics) return;
        const usage = assistantUsage(message);
        metrics.inputTokens += usage.inputTokens;
        metrics.outputTokens += usage.outputTokens;
        metrics.reasoningTokens = (metrics.reasoningTokens ?? 0) + usage.reasoningTokens;
        metrics.cachedInputTokens = (metrics.cachedInputTokens ?? 0) + usage.cachedInputTokens;
        metrics.estimatedCost = (metrics.estimatedCost ?? 0) + usage.estimatedCost;
        const model = target ? targetLabel(target) : undefined;
        const modelUsage = model
            ? metrics.modelUsage?.find((entry) => entry.model === model)
            : undefined;
        if (modelUsage) {
            modelUsage.inputTokens += usage.inputTokens;
            modelUsage.outputTokens += usage.outputTokens;
            modelUsage.reasoningTokens += usage.reasoningTokens;
            modelUsage.cachedInputTokens += usage.cachedInputTokens;
            modelUsage.estimatedCost += usage.estimatedCost;
        }
    };

    const roleLabel = (role: RoutingModelRole): string => {
        if (role === "manual") return "manual override";
        return role;
    };

    const publishRoute = (
        ctx: ExtensionContext,
        _target: RoutingTarget,
        role: RoutingModelRole,
    ): void => {
        const decision = lastRouterDecision ? ` · ${lastRouterDecision}` : "";
        ctx.ui.setStatus("routing-profile", activePresetName);
        ctx.ui.setStatus("routing", `routing: ${roleLabel(role)}${decision}`);
    };

    const announceRouteChange = (
        ctx: ExtensionContext,
        previousRole: RoutingModelRole,
        target: RoutingTarget,
        role: RoutingModelRole,
    ): void => {
        if (previousRole === role) return;
        if (role === "fast") {
            ctx.ui.notify(`Routing downshifted: ${targetLabel(target)}`, "info");
            return;
        }
        if (role === "base") {
            ctx.ui.notify(`Routing restored base: ${targetLabel(target)}`, "info");
            return;
        }
        ctx.ui.notify(`Routing escalated: ${role} · ${targetLabel(target)}`, "info");
    };

    const applyThinkingLevel = (level: RoutingThinkingLevel | undefined): void => {
        if (level !== undefined && pi.getThinkingLevel() !== level) pi.setThinkingLevel(level);
    };

    const selectTarget = async (
        target: RoutingTarget | undefined,
        role: RoutingModelRole,
        ctx: ExtensionContext,
        force = false,
    ): Promise<boolean> => {
        if (!target || (automaticRoutingPaused() && !force)) return false;
        const previousRole = activeTurnRole;
        const targetKey = modelKey(target.model);
        switchInProgress = true;
        try {
            if (!currentModel || modelKey(currentModel) !== targetKey) {
                expectedModelKey = targetKey;
                const success = await pi.setModel(target.model);
                if (!success) {
                    warn(
                        ctx,
                        `Routing could not select ${target.model.provider}/${target.model.id}`,
                    );
                    return false;
                }
                currentModel = target.model;
            }
            applyThinkingLevel(target.thinkingLevel);
            activeTurnRole = role;
            currentTarget = target;
            extensionOwnsActiveModel = role !== "base";
            recordTaskTarget(target, role, !automaticRoutingPaused() && state.recoveryIndex > 0);
            publishRoute(ctx, target, role);
            announceRouteChange(ctx, previousRole, target, role);
            return true;
        } finally {
            expectedModelKey = undefined;
            switchInProgress = false;
        }
    };

    const activeTarget = (): RoutingTarget | undefined => currentTarget;

    const selectRecoveryTarget = async (ctx: ExtensionContext): Promise<boolean> => {
        const candidate = recoveryLadder.at(state.recoveryIndex);
        if (!candidate || candidate.role === "base") return false;
        return selectTarget(candidate.target, candidate.role, ctx);
    };

    const holdWarmRoute = (desiredRole: RoutingModelRole, ctx: ExtensionContext): boolean => {
        const target = activeTarget();
        if (!target || rolePriority(activeTurnRole) <= rolePriority(desiredRole)) {
            return false;
        }
        if (!lastModelUse || lastModelUse.key !== modelKey(target.model)) return false;

        const ttlMinutes =
            target.cacheTtlMinutes ??
            presetCacheTtlMinutes ??
            configuredCacheTtlMinutes ??
            defaultCacheTtlMinutes(target);
        const remainingMs = lastModelUse.at + ttlMinutes * MINUTE_MS - Date.now();
        if (remainingMs <= 0) return false;

        lastRouterDecision = `warm route: ${Math.ceil(remainingMs / MINUTE_MS)}m`;
        publishRoute(ctx, target, activeTurnRole);
        return true;
    };

    const finishSubtask = (ctx: ExtensionContext, completed = false): void => {
        const restoreBaseTarget = activeTurnRole === "manual" || manualRoleOverride !== undefined;
        if (taskMetrics) {
            taskMetrics.completed ||= completed;
            taskMetrics.stagnationEvents = state.stagnationEvents;
            if (taskMetrics.turns > 0) pi.appendEntry(ROUTING_TASK_ENTRY, taskMetrics);
            taskMetrics = undefined;
        }
        state = initialRoutingState();
        manualModelOverride = false;
        manualRoleOverride = undefined;
        taskCompletePending = false;
        completionOnlyTurn = false;
        subtaskStarted = false;
        lastTurnRole = undefined;
        lastRouterDecision = undefined;
        if (restoreBaseTarget && baseTarget) {
            activeTurnRole = "base";
            currentTarget = undefined;
            publishRoute(ctx, baseTarget, "base");
        }
    };

    const activateRoutingPreset = async (
        name: string,
        preset: RoutingPreset | undefined,
        ctx: ExtensionContext,
    ): Promise<boolean> => {
        if (!preset) {
            warn(ctx, `Unknown routing preset: ${name}`);
            return false;
        }

        const resolvedBase = resolveTarget(normalizeTargetSetting(preset.base), ctx);
        const resolvedFast = resolveTarget(normalizeTargetSetting(preset.fast), ctx);
        const resolvedEscalated = resolveTarget(normalizeTargetSetting(preset.escalated), ctx);
        const resolvedDeep = resolveTarget(normalizeTargetSetting(preset.deep), ctx);
        if (
            typeof resolvedBase === "string" ||
            typeof resolvedFast === "string" ||
            typeof resolvedEscalated === "string" ||
            typeof resolvedDeep === "string"
        ) {
            for (const target of [resolvedBase, resolvedFast, resolvedEscalated, resolvedDeep]) {
                if (typeof target === "string") warn(ctx, target);
            }
            return false;
        }
        if (!resolvedBase) {
            warn(ctx, `Routing preset requires a base model: ${name}`);
            return false;
        }
        if (taskMetrics) finishSubtask(ctx);

        const previousManualModelOverride = manualModelOverride;
        const previousManualRoleOverride = manualRoleOverride;
        manualModelOverride = false;
        manualRoleOverride = undefined;
        lastRouterDecision = undefined;
        if (!(await selectTarget(resolvedBase, "base", ctx))) {
            manualModelOverride = previousManualModelOverride;
            manualRoleOverride = previousManualRoleOverride;
            return false;
        }

        baseTarget = resolvedBase;
        escalatedTarget = resolvedEscalated;
        deepTarget = resolvedDeep;
        rebuildRecoveryLadder();
        presetCacheTtlMinutes = normalizeCacheTtlMinutes(preset.cacheTtlMinutes);
        baselineTarget = resolvedBase;
        configuredBase = true;
        fastTarget =
            resolvedFast && routingTargetKey(resolvedFast) !== routingTargetKey(resolvedBase)
                ? resolvedFast
                : undefined;
        activePresetName = name;
        state = initialRoutingState();
        activeTurnRole = "base";
        lastTurnRole = undefined;
        extensionOwnsActiveModel = false;
        manualModelOverride = false;
        manualRoleOverride = undefined;
        subtaskStarted = false;
        taskCompletePending = false;
        completionOnlyTurn = false;
        pendingInputs = [];
        currentPromptHasImages = false;
        lastModelUse = undefined;
        lastRouterDecision = undefined;
        publishRoute(ctx, resolvedBase, "base");
        return true;
    };

    const routeNormalTurn = async (
        hasImages: boolean,
        prompt: string,
        ctx: ExtensionContext,
    ): Promise<void> => {
        if (automaticRoutingPaused() || !baseTarget) return;
        if (await selectRecoveryTarget(ctx)) return;

        // Fast gets one response. Any continuation moves to base; base then stays
        // put for the rest of the subtask instead of churning the prompt prefix.
        if (lastTurnRole !== undefined) {
            if (lastTurnRole === "fast" || state.forceBase) {
                lastRouterDecision = state.forceBase ? lastRouterDecision : "continuation";
                await selectTarget(baseTarget, "base", ctx);
            }
            return;
        }

        const complexity = routingTaskComplexity(prompt);
        const useBase = !fastTarget || state.forceBase || hasImages || complexity.score >= 2;
        const desiredRole: RoutingModelRole = useBase ? "base" : "fast";
        const target = useBase ? baseTarget : fastTarget;
        if (!target) return;
        if (!hasImages && holdWarmRoute(desiredRole, ctx)) return;
        if (!useBase) {
            lastRouterDecision = "simple first pass";
        } else if (!fastTarget) {
            lastRouterDecision = "base target";
        } else if (hasImages) {
            lastRouterDecision = "image input";
        } else if (!state.forceBase) {
            lastRouterDecision = complexity.reason ?? "multi-step task";
        }
        await selectTarget(target, desiredRole, ctx);
    };

    const applyUserBoundary = (text: string, ctx: ExtensionContext): boolean => {
        const signal = classifyRoutingUserSignal(text);
        if (signal === "complete") {
            finishSubtask(ctx, true);
            // The acknowledgement still gets an LLM turn. Mark that interaction so
            // the next independent prompt clears its turn outcome as a new boundary.
            subtaskStarted = true;
            return true;
        }
        if (signal === "new-task" && subtaskStarted) finishSubtask(ctx);

        if (signal === "negative" && lastTurnRole) {
            const metrics = ensureTaskMetrics();
            if (metrics) metrics.correctionCount++;
            if (automaticRoutingPaused()) {
                subtaskStarted = true;
                return false;
            }

            const previousRecoveryIndex = state.recoveryIndex;
            state = recordRoutingCorrection(
                state,
                correctionThreshold,
                recoveryLadder.length,
                lastTurnRole,
            );
            if (previousRecoveryIndex !== state.recoveryIndex) {
                lastRouterDecision = "correction threshold reached";
            }
        }
        subtaskStarted = true;
        return false;
    };

    pi.events.on("pidev:task_complete", () => {
        taskCompletePending = true;
    });

    pi.on("session_start", async (_event, ctx) => {
        const config = configRef.current.routing;
        routingConfigured =
            config?.base !== undefined ||
            config?.fast !== undefined ||
            config?.escalated !== undefined ||
            config?.deep !== undefined ||
            Object.keys(config?.presets ?? {}).length > 0;
        state = initialRoutingState();
        taskMetrics = undefined;
        activeTurnRole = "base";
        lastTurnRole = undefined;
        currentModel = ctx.model;
        baseTarget = ctx.model
            ? { model: ctx.model, thinkingLevel: pi.getThinkingLevel() }
            : undefined;
        currentTarget = baseTarget;
        escalatedTarget = undefined;
        baselineTarget = baseTarget;
        configuredBase = false;
        fastTarget = undefined;
        deepTarget = undefined;
        recoveryLadder = buildRoutingRecoveryLadder(baseTarget, escalatedTarget, deepTarget);
        extensionOwnsActiveModel = false;
        manualModelOverride = false;
        manualRoleOverride = undefined;
        subtaskStarted = false;
        taskCompletePending = false;
        completionOnlyTurn = false;
        pendingInputs = [];
        lastModelUse = undefined;
        lastRouterDecision = undefined;
        activePresetName = undefined;
        ctx.ui.setStatus("routing-profile", undefined);
        failureThreshold = normalizeFailureThreshold(config?.failureThreshold);
        correctionThreshold = normalizeFailureThreshold(config?.correctionThreshold);
        stagnationThreshold = normalizeFailureThreshold(config?.stagnationThreshold);
        configuredCacheTtlMinutes = normalizeCacheTtlMinutes(config?.cacheTtlMinutes);
        presetCacheTtlMinutes = undefined;

        if (!routingConfigured) {
            ctx.ui.setStatus("routing", undefined);
            return;
        }

        const configuredPresets = config?.presets ?? {};
        const requestedPresets = [restoredPresetName(ctx), config?.defaultPreset?.trim()].filter(
            (name, index, names): name is string => Boolean(name) && names.indexOf(name) === index,
        );
        for (const name of requestedPresets) {
            if (await activateRoutingPreset(name, configuredPresets[name], ctx)) return;
        }

        const resolvedBase = resolveTarget(normalizeTargetSetting(config?.base), ctx);
        const resolvedFast = resolveTarget(normalizeTargetSetting(config?.fast), ctx);
        const resolvedEscalated = resolveTarget(normalizeTargetSetting(config?.escalated), ctx);
        const resolvedDeep = resolveTarget(normalizeTargetSetting(config?.deep), ctx);
        if (typeof resolvedBase === "string") warn(ctx, resolvedBase);
        else if (resolvedBase) {
            baseTarget = resolvedBase;
            baselineTarget = resolvedBase;
            configuredBase = true;
            await selectTarget(baseTarget, "base", ctx);
        }
        if (typeof resolvedFast === "string") warn(ctx, resolvedFast);
        else fastTarget = resolvedFast;
        if (typeof resolvedEscalated === "string") warn(ctx, resolvedEscalated);
        else escalatedTarget = resolvedEscalated;
        if (typeof resolvedDeep === "string") warn(ctx, resolvedDeep);
        else deepTarget = resolvedDeep;

        if (
            baseTarget &&
            fastTarget &&
            routingTargetKey(baseTarget) === routingTargetKey(fastTarget)
        ) {
            fastTarget = undefined;
        }
        rebuildRecoveryLadder();
        if (baseTarget) publishRoute(ctx, baseTarget, "base");
    });

    pi.on("input", (event) => {
        if (!routingConfigured || event.source === "extension") return;
        pendingInputs.push({ text: event.text, hasImages: (event.images?.length ?? 0) > 0 });
    });

    pi.on("before_agent_start", async (event, ctx) => {
        if (!routingConfigured) return;
        const pendingInput = pendingInputs.shift();
        currentPromptHasImages =
            (event.images?.length ?? 0) > 0 || (pendingInput?.hasImages ?? false);
        const boundaryText = pendingInput?.text ?? event.prompt;

        const completionOnly = applyUserBoundary(boundaryText, ctx);
        completionOnlyTurn = completionOnly;
        if (completionOnly) return;
        if (automaticRoutingPaused()) {
            ensureTaskMetrics();
            return;
        }

        await routeNormalTurn(currentPromptHasImages, event.prompt, ctx);
        ensureTaskMetrics();
    });

    pi.on("turn_start", () => {
        if (routingConfigured && currentModel) {
            lastModelUse = { key: modelKey(currentModel), at: Date.now() };
        }
    });

    pi.on("turn_end", async (event, ctx) => {
        if (!routingConfigured) return;
        if (completionOnlyTurn) {
            completionOnlyTurn = false;
            return;
        }
        const completedRole = activeTurnRole;
        const completedTarget = activeTarget();
        lastTurnRole = completedRole;

        const failure = classifyRoutingFailure({
            assistant: assistantFailureInput(event.message),
            toolResults: event.toolResults.map((result) => ({
                toolName: result.toolName,
                isError: result.isError,
                output: toolResultOutput(result),
            })),
        });
        if (!automaticRoutingPaused()) {
            const previousRecoveryIndex = state.recoveryIndex;
            const previousStagnationEvents = state.stagnationEvents;
            state = recordRoutingFailure(state, completedRole, failure, {
                failureThreshold,
                stagnationThreshold,
                recoveryTargetCount: recoveryLadder.length,
                attemptedRemediation: event.toolResults.some(toolResultAttemptsRemediation),
                developmentSucceeded: event.toolResults.some(toolResultSignalsDevelopmentSuccess),
            });
            const reason = failureReason(failure.kind, failure.signature);
            if (previousRecoveryIndex !== state.recoveryIndex) {
                lastRouterDecision =
                    state.stagnationEvents > previousStagnationEvents
                        ? "stagnation threshold reached"
                        : `${reason} threshold reached`;
            } else if (failure.kind === "assistant" || failure.kind === "context-limit") {
                lastRouterDecision = reason;
            }
        }

        const metrics = ensureTaskMetrics();
        if (metrics) {
            metrics.turns++;
            const kinds = new Set(failure.kinds);
            if (kinds.has("assistant") || kinds.has("context-limit")) metrics.assistantFailures++;
            if (kinds.has("tool-infrastructure")) metrics.infrastructureFailures++;
            if (kinds.has("development")) metrics.developmentFailures++;
            metrics.stagnationEvents = state.stagnationEvents;
            recordTaskUsage(event.message, completedTarget);
        }

        const queuedInputs = pendingInputs.splice(0);
        const hasQueuedInput = queuedInputs.length > 0;
        let completionOnly = false;
        if (hasQueuedInput) {
            currentPromptHasImages = queuedInputs.some((input) => input.hasImages);
            for (const input of queuedInputs) {
                completionOnly = applyUserBoundary(input.text, ctx);
            }
        }

        if (completionOnly || automaticRoutingPaused()) return;
        if (await selectRecoveryTarget(ctx)) return;
        if (event.toolResults.length > 0 || hasQueuedInput) {
            await routeNormalTurn(currentPromptHasImages, queuedInputs.at(-1)?.text ?? "", ctx);
        }
    });

    pi.on("agent_settled", (_event, ctx) => {
        if (taskCompletePending) finishSubtask(ctx, true);
    });

    pi.on("model_select", (event, ctx) => {
        if (!routingConfigured) return;
        currentModel = event.model;
        if (expectedModelKey === modelKey(event.model)) return;
        const selected = { model: event.model, thinkingLevel: pi.getThinkingLevel() };
        if (event.source === "restore" && !subtaskStarted) {
            if (!configuredBase) {
                baseTarget = selected;
                baselineTarget = selected;
                rebuildRecoveryLadder();
            }
            if (baseTarget) publishRoute(ctx, baseTarget, "base");
            return;
        }

        if (!configuredBase) {
            baseTarget = selected;
            rebuildRecoveryLadder();
        }
        lastRouterDecision = undefined;
        activeTurnRole = "manual";
        extensionOwnsActiveModel = false;
        manualModelOverride = true;
        manualRoleOverride = undefined;
        currentTarget = selected;
        recordTaskTarget(selected, "manual");
        publishRoute(ctx, selected, "manual");
    });

    pi.registerCommand("routing-preset", {
        description: "Select a routing model preset after current work finishes",
        getArgumentCompletions: (prefix) => {
            const normalized = prefix.trim().toLowerCase();
            const items = Object.keys(configRef.current.routing?.presets ?? {})
                .filter((name) => name.toLowerCase().startsWith(normalized))
                .sort()
                .map((name) => ({ value: name, label: name }));
            return items.length > 0 ? items : null;
        },
        handler: async (args, ctx) => {
            const presets = configRef.current.routing?.presets ?? {};
            const names = Object.keys(presets).sort();
            if (names.length === 0) {
                warn(ctx, "No routing presets are configured");
                return;
            }

            let name = args.trim();
            if (!name) {
                if (!ctx.hasUI) {
                    warn(ctx, `Usage: /routing-preset <${names.join("|")}>`);
                    return;
                }
                name = (await ctx.ui.select("Routing preset", names)) ?? "";
            }
            if (!name) return;

            if (!ctx.isIdle()) {
                ctx.ui.notify(
                    `Routing preset will apply after the current work is done: ${name}`,
                    "info",
                );
            }
            await ctx.waitForIdle();
            if (await activateRoutingPreset(name, presets[name], ctx)) {
                pi.appendEntry(ROUTING_PRESET_ENTRY, { name });
                ctx.ui.notify(`Routing preset activated: ${name}`, "info");
            }
        },
    });

    const resumeAutomaticRouting = async (ctx: ExtensionContext): Promise<boolean> => {
        if (!routingConfigured || !baselineTarget) {
            warn(ctx, "Automatic routing is not configured");
            return false;
        }
        baseTarget = baselineTarget;
        rebuildRecoveryLadder();
        finishSubtask(ctx);
        if (!(await selectTarget(baseTarget, "base", ctx, true))) return false;
        ctx.ui.notify(`Automatic routing restored: ${targetLabel(baseTarget)}`, "info");
        return true;
    };

    const routingRoleCommand = {
        description:
            "Force a routing role for the current subtask: fast, base, escalated, deep, or auto",
        getArgumentCompletions: (prefix: string) => {
            const normalized = prefix.trim().toLowerCase();
            const roles = ["fast", "base", "escalated", "deep", "auto"];
            const matches = roles.filter((role) => role.startsWith(normalized));
            return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
        },
        handler: async (args: string, ctx: ExtensionContext) => {
            const role = args.trim().toLowerCase();
            if (role === "auto") {
                await resumeAutomaticRouting(ctx);
                return;
            }
            if (role !== "fast" && role !== "base" && role !== "escalated" && role !== "deep") {
                warn(ctx, "Usage: /routing-role <fast|base|escalated|deep|auto>");
                return;
            }
            if (!routingConfigured) {
                warn(ctx, "Automatic routing is not configured");
                return;
            }

            const target = targetForRole(role);
            if (!target) {
                warn(ctx, `Routing role is not configured: ${role}`);
                return;
            }
            manualModelOverride = false;
            manualRoleOverride = role;
            lastRouterDecision = "manual role";
            if (await selectTarget(target, role, ctx, true)) {
                ctx.ui.notify(`Routing role forced: ${role}`, "info");
                return;
            }
            manualRoleOverride = undefined;
        },
    };

    pi.registerCommand("routing-role", routingRoleCommand);
    pi.registerCommand("route", routingRoleCommand);

    pi.registerCommand("routing-auto", {
        description: "Clear model and role overrides and resume automatic routing",
        handler: async (_args, ctx) => {
            await resumeAutomaticRouting(ctx);
        },
    });

    pi.on("thinking_level_select", (event) => {
        if (
            !routingConfigured ||
            switchInProgress ||
            extensionOwnsActiveModel ||
            !baseTarget ||
            !currentModel ||
            modelKey(baseTarget.model) !== modelKey(currentModel)
        ) {
            return;
        }
        baseTarget = { ...baseTarget, thinkingLevel: event.level };
        rebuildRecoveryLadder();
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        finishSubtask(ctx);
        if (routingConfigured && extensionOwnsActiveModel && !automaticRoutingPaused()) {
            await selectTarget(baseTarget, "base", ctx);
        }
        ctx.ui.setStatus("routing-profile", undefined);
        ctx.ui.setStatus("routing", undefined);
    });
}
