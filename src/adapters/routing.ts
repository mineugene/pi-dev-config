import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    classifyRoutingUserSignal,
    initialRoutingState,
    normalizeFailureThreshold,
    type RoutingModelRole,
    type RoutingState,
    recordRoutingCorrection,
    recordRoutingOutcome,
    routingTaskNeedsBase,
} from "../domain/routing.ts";
import type {
    PiDevConfig,
    RoutingModelSetting,
    RoutingPreset,
    RoutingThinkingLevel,
} from "../infra/config.ts";

const MINUTE_MS = 60_000;
const SHORT_CACHE_TTL_MINUTES = 5;
const ROUTING_PRESET_ENTRY = "pidev:routing-preset";

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
}

interface NormalizedTargetSetting {
    model: string;
    thinkingLevel?: RoutingThinkingLevel;
}

function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
    return `${model.provider}/${model.id}`.toLowerCase();
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
    const thinkingLevel = ROUTING_THINKING_LEVELS.has(setting.thinkingLevel as RoutingThinkingLevel)
        ? setting.thinkingLevel
        : undefined;
    return model ? { model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) } : undefined;
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

function assistantFailed(message: unknown): boolean {
    if (!message || typeof message !== "object") return false;
    const stopReason = (message as { stopReason?: unknown }).stopReason;
    return stopReason === "error" || stopReason === "length";
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
    if (role === "deep") return 2;
    return 1;
}

export default function registerRouting(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    let baseTarget: RoutingTarget | undefined;
    let baselineTarget: RoutingTarget | undefined;
    let configuredBase = false;
    let fastTarget: RoutingTarget | undefined;
    let deepTarget: RoutingTarget | undefined;
    let state: RoutingState = initialRoutingState();
    let activeTurnRole: RoutingModelRole = "base";
    let lastTurnRole: RoutingModelRole | undefined;
    let currentModel: Model<Api> | undefined;
    let expectedModelKey: string | undefined;
    let switchInProgress = false;
    let extensionOwnsActiveModel = false;
    let manualOverride = false;
    let subtaskStarted = false;
    let taskCompletePending = false;
    let pendingInputs: Array<{ text: string; hasImages: boolean }> = [];
    let currentPromptHasImages = false;
    let failureThreshold = 2;
    let correctionThreshold = 2;
    let configuredCacheTtlMinutes: number | undefined;
    let lastModelUse: { key: string; at: number } | undefined;
    let lastRouterDecision: string | undefined;
    let activePresetName: string | undefined;
    let routingConfigured = false;

    const warn = (ctx: ExtensionContext, message: string): void => {
        ctx.ui.notify(message, "warning");
    };

    const targetLabel = (target: RoutingTarget): string =>
        `${target.model.provider}/${target.model.id}`;

    const roleLabel = (role: RoutingModelRole): string => {
        if (role === "fast") return "fast";
        if (role === "deep") return "deep";
        if (role === "manual") return "manual override";
        return "base";
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
        const action =
            role === "fast" ? "downshifted" : role === "deep" ? "escalated" : "restored base";
        ctx.ui.notify(`Routing ${action}: ${targetLabel(target)}`, "info");
    };

    const applyThinkingLevel = (level: RoutingThinkingLevel | undefined): void => {
        if (level !== undefined) pi.setThinkingLevel(level);
    };

    const selectTarget = async (
        target: RoutingTarget | undefined,
        role: RoutingModelRole,
        ctx: ExtensionContext,
    ): Promise<boolean> => {
        if (!target || manualOverride) return false;
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
            extensionOwnsActiveModel = role !== "base";
            publishRoute(ctx, target, role);
            announceRouteChange(ctx, previousRole, target, role);
            return true;
        } finally {
            expectedModelKey = undefined;
            switchInProgress = false;
        }
    };

    const activeTarget = (): RoutingTarget | undefined => {
        if (activeTurnRole === "fast") return fastTarget;
        if (activeTurnRole === "deep") return deepTarget;
        return baseTarget;
    };

    const holdWarmRoute = (desiredRole: RoutingModelRole, ctx: ExtensionContext): boolean => {
        const target = activeTarget();
        if (!target || rolePriority(activeTurnRole) <= rolePriority(desiredRole)) return false;
        if (!lastModelUse || lastModelUse.key !== modelKey(target.model)) return false;

        const ttlMinutes = configuredCacheTtlMinutes ?? defaultCacheTtlMinutes(target);
        const remainingMs = lastModelUse.at + ttlMinutes * MINUTE_MS - Date.now();
        if (remainingMs <= 0) return false;

        lastRouterDecision = `warm prefix: ${Math.ceil(remainingMs / MINUTE_MS)}m`;
        publishRoute(ctx, target, activeTurnRole);
        return true;
    };

    const finishSubtask = (ctx: ExtensionContext): void => {
        state = initialRoutingState();
        manualOverride = false;
        taskCompletePending = false;
        subtaskStarted = false;
        lastTurnRole = undefined;
        lastRouterDecision = undefined;
        if (activeTurnRole === "manual" && baseTarget) {
            activeTurnRole = "base";
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
        const resolvedDeep = resolveTarget(normalizeTargetSetting(preset.deep), ctx);
        if (
            typeof resolvedBase === "string" ||
            typeof resolvedFast === "string" ||
            typeof resolvedDeep === "string"
        ) {
            for (const target of [resolvedBase, resolvedFast, resolvedDeep]) {
                if (typeof target === "string") warn(ctx, target);
            }
            return false;
        }
        if (!resolvedBase) {
            warn(ctx, `Routing preset requires a base model: ${name}`);
            return false;
        }

        const previousManualOverride = manualOverride;
        manualOverride = false;
        lastRouterDecision = undefined;
        if (!(await selectTarget(resolvedBase, "base", ctx))) {
            manualOverride = previousManualOverride;
            return false;
        }

        baseTarget = resolvedBase;
        baselineTarget = resolvedBase;
        configuredBase = true;
        fastTarget =
            resolvedFast && modelKey(resolvedFast.model) !== modelKey(resolvedBase.model)
                ? resolvedFast
                : undefined;
        deepTarget =
            resolvedDeep && modelKey(resolvedDeep.model) !== modelKey(resolvedBase.model)
                ? resolvedDeep
                : undefined;
        activePresetName = name;
        state = initialRoutingState();
        activeTurnRole = "base";
        lastTurnRole = undefined;
        extensionOwnsActiveModel = false;
        manualOverride = false;
        subtaskStarted = false;
        taskCompletePending = false;
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
        if (manualOverride || state.phase === "ESCALATED" || !baseTarget) return;

        // Fast gets one response. Any continuation moves to base; base then stays
        // put for the rest of the subtask instead of churning the prompt prefix.
        if (lastTurnRole !== undefined) {
            if (lastTurnRole === "fast" || state.forceBase) {
                lastRouterDecision = undefined;
                await selectTarget(baseTarget, "base", ctx);
            }
            return;
        }

        const useBase = !fastTarget || state.forceBase || hasImages || routingTaskNeedsBase(prompt);
        const desiredRole: RoutingModelRole = useBase ? "base" : "fast";
        if (!hasImages && holdWarmRoute(desiredRole, ctx)) return;

        const target = useBase ? baseTarget : fastTarget;
        lastRouterDecision = useBase || !target ? undefined : `first pass: ${targetLabel(target)}`;
        await selectTarget(target, desiredRole, ctx);
    };

    const applyUserBoundary = (text: string, ctx: ExtensionContext): boolean => {
        const signal = classifyRoutingUserSignal(text);
        if (signal === "complete") {
            finishSubtask(ctx);
            // The acknowledgement still gets an LLM turn. Mark that interaction so
            // the next independent prompt clears its turn outcome as a new boundary.
            subtaskStarted = true;
            return true;
        }
        if (signal === "new-task" && subtaskStarted) finishSubtask(ctx);

        if (signal === "negative" && lastTurnRole && !manualOverride) {
            state = recordRoutingCorrection(state, correctionThreshold, deepTarget !== undefined);
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
            config?.deep !== undefined ||
            Object.keys(config?.presets ?? {}).length > 0;
        state = initialRoutingState();
        activeTurnRole = "base";
        lastTurnRole = undefined;
        currentModel = ctx.model;
        baseTarget = ctx.model
            ? { model: ctx.model, thinkingLevel: pi.getThinkingLevel() }
            : undefined;
        baselineTarget = baseTarget;
        configuredBase = false;
        fastTarget = undefined;
        deepTarget = undefined;
        extensionOwnsActiveModel = false;
        manualOverride = false;
        subtaskStarted = false;
        taskCompletePending = false;
        pendingInputs = [];
        lastModelUse = undefined;
        lastRouterDecision = undefined;
        activePresetName = undefined;
        ctx.ui.setStatus("routing-profile", undefined);
        failureThreshold = normalizeFailureThreshold(config?.failureThreshold);
        correctionThreshold = normalizeFailureThreshold(config?.correctionThreshold);
        configuredCacheTtlMinutes = normalizeCacheTtlMinutes(config?.cacheTtlMinutes);

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
        if (typeof resolvedDeep === "string") warn(ctx, resolvedDeep);
        else deepTarget = resolvedDeep;

        if (baseTarget && fastTarget && modelKey(baseTarget.model) === modelKey(fastTarget.model)) {
            fastTarget = undefined;
        }
        if (baseTarget && deepTarget && modelKey(baseTarget.model) === modelKey(deepTarget.model)) {
            deepTarget = undefined;
        }
        if (baseTarget) publishRoute(ctx, baseTarget, "base");
    });

    pi.on("input", (event) => {
        if (!routingConfigured || event.source === "extension") return;
        pendingInputs.push({ text: event.text, hasImages: (event.images?.length ?? 0) > 0 });
    });

    pi.on("before_agent_start", async (event, ctx) => {
        if (!routingConfigured || (!fastTarget && !deepTarget)) return;
        const pendingInput = pendingInputs.shift();
        currentPromptHasImages =
            (event.images?.length ?? 0) > 0 || (pendingInput?.hasImages ?? false);
        const boundaryText = pendingInput?.text ?? event.prompt;

        const completionOnly = applyUserBoundary(boundaryText, ctx);
        if (manualOverride || completionOnly) return;

        if (state.phase === "ESCALATED") {
            lastRouterDecision = undefined;
            await selectTarget(deepTarget, "deep", ctx);
            return;
        }
        await routeNormalTurn(currentPromptHasImages, event.prompt, ctx);
    });

    pi.on("turn_start", () => {
        if (routingConfigured && currentModel) {
            lastModelUse = { key: modelKey(currentModel), at: Date.now() };
        }
    });

    pi.on("turn_end", async (event, ctx) => {
        if (!routingConfigured || (!fastTarget && !deepTarget)) return;
        const completedRole = activeTurnRole;
        lastTurnRole = completedRole;

        const failed =
            assistantFailed(event.message) || event.toolResults.some((result) => result.isError);
        if (!manualOverride && state.phase === "NORMAL") {
            state = recordRoutingOutcome(
                state,
                completedRole,
                failed,
                failureThreshold,
                deepTarget !== undefined,
            );
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

        if (completionOnly || manualOverride) return;
        if (state.phase === "ESCALATED") {
            lastRouterDecision = undefined;
            await selectTarget(deepTarget, "deep", ctx);
            return;
        }
        if (event.toolResults.length > 0 || hasQueuedInput) {
            await routeNormalTurn(currentPromptHasImages, queuedInputs.at(-1)?.text ?? "", ctx);
        }
    });

    pi.on("agent_settled", (_event, ctx) => {
        if (taskCompletePending) finishSubtask(ctx);
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
            }
            if (baseTarget) publishRoute(ctx, baseTarget, "base");
            return;
        }

        if (!configuredBase) baseTarget = selected;
        lastRouterDecision = undefined;
        activeTurnRole = "manual";
        extensionOwnsActiveModel = false;
        manualOverride = true;
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

    pi.registerCommand("routing-auto", {
        description: "Clear the model override and resume automatic routing",
        handler: async (_args, ctx) => {
            if (!routingConfigured || !baselineTarget) {
                warn(ctx, "Automatic routing is not configured");
                return;
            }
            baseTarget = baselineTarget;
            finishSubtask(ctx);
            if (await selectTarget(baseTarget, "base", ctx)) {
                ctx.ui.notify(`Automatic routing restored: ${targetLabel(baseTarget)}`, "info");
            }
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
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        if (routingConfigured && extensionOwnsActiveModel && !manualOverride) {
            await selectTarget(baseTarget, "base", ctx);
        }
        ctx.ui.setStatus("routing-profile", undefined);
        ctx.ui.setStatus("routing", undefined);
    });
}
