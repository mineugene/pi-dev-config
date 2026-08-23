import { finiteNumberOrZero } from "./number.ts";
import type { RoutingModelRole } from "./routing.ts";

export interface DashboardSessionMessage {
    provider: string;
    model: string;
    cost: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    timestamp: number;
}

export interface RoutingModelUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    estimatedCost: number;
}

export interface RoutingTaskMetrics {
    taskId: string;
    preset: string;
    startingRole: RoutingModelRole;
    highestRole: RoutingModelRole;
    modelsUsed: string[];
    thinkingLevelsUsed: string[];
    modelUsage?: RoutingModelUsage[];
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    estimatedCost?: number;
    assistantFailures: number;
    infrastructureFailures: number;
    developmentFailures: number;
    stagnationEvents: number;
    correctionCount: number;
    /** Automatic recovery entered the explicit escalated role. */
    usedEscalated: boolean;
    /** Automatic recovery entered the deep role. */
    usedDeep: boolean;
    turns: number;
    completed: boolean;
}

export interface DashboardRoutingTask {
    task: RoutingTaskMetrics;
    timestamp: number;
}

export interface RoutingModelSummary {
    model: string;
    tasks: number;
    completed: number;
    estimatedCost: number;
    costPerSuccess: number;
}

export interface RoutingTaskSummary {
    tasks: number;
    completed: number;
    startedFast: number;
    startedBase: number;
    fastToBase: number;
    escalatedRecoveries: number;
    deepRecoveries: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    estimatedCost: number;
    costPerSuccess: number;
    corrections: number;
    stagnationEvents: number;
    assistantFailures: number;
    infrastructureFailures: number;
    developmentFailures: number;
    models: RoutingModelSummary[];
}

export type DashboardSessionEntry =
    | { type: "session"; sessionId: string }
    | { type: "message"; message: DashboardSessionMessage }
    | ({ type: "routing-task" } & DashboardRoutingTask);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function nonNegativeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedString(value: unknown, maxLength = 160): string | undefined {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength
        ? value
        : undefined;
}

function boundedStrings(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.length > 32) return undefined;
    const strings = value.map((item) => boundedString(item));
    return strings.every((item): item is string => item !== undefined) ? strings : undefined;
}

function routingRole(value: unknown): RoutingModelRole | undefined {
    return value === "fast" ||
        value === "base" ||
        value === "escalated" ||
        value === "deep" ||
        value === "manual"
        ? value
        : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return value === undefined ? undefined : nonNegativeNumber(value);
}

function decodeModelUsage(value: unknown): RoutingModelUsage[] | undefined {
    if (!Array.isArray(value) || value.length > 32) return undefined;
    const usage: RoutingModelUsage[] = [];
    for (const item of value) {
        if (!isRecord(item)) return undefined;
        const model = boundedString(item.model);
        const inputTokens = nonNegativeNumber(item.inputTokens);
        const outputTokens = nonNegativeNumber(item.outputTokens);
        const reasoningTokens = nonNegativeNumber(item.reasoningTokens);
        const cachedInputTokens = nonNegativeNumber(item.cachedInputTokens);
        const estimatedCost = nonNegativeNumber(item.estimatedCost);
        if (
            !model ||
            inputTokens === undefined ||
            outputTokens === undefined ||
            reasoningTokens === undefined ||
            cachedInputTokens === undefined ||
            estimatedCost === undefined
        ) {
            return undefined;
        }
        usage.push({
            model,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cachedInputTokens,
            estimatedCost,
        });
    }
    return usage;
}

function decodeRoutingTaskMetrics(value: unknown): RoutingTaskMetrics | undefined {
    if (!isRecord(value)) return undefined;
    const taskId = boundedString(value.taskId, 128);
    const preset = boundedString(value.preset);
    const startingRole = routingRole(value.startingRole);
    const highestRole = routingRole(value.highestRole);
    const modelsUsed = boundedStrings(value.modelsUsed);
    const thinkingLevelsUsed = boundedStrings(value.thinkingLevelsUsed);
    const modelUsage =
        value.modelUsage === undefined ? undefined : decodeModelUsage(value.modelUsage);
    const inputTokens = nonNegativeNumber(value.inputTokens);
    const outputTokens = nonNegativeNumber(value.outputTokens);
    const assistantFailures = nonNegativeNumber(value.assistantFailures);
    const infrastructureFailures = nonNegativeNumber(value.infrastructureFailures);
    const developmentFailures = nonNegativeNumber(value.developmentFailures);
    const stagnationEvents = nonNegativeNumber(value.stagnationEvents);
    const correctionCount = nonNegativeNumber(value.correctionCount);
    const turns = nonNegativeNumber(value.turns);
    const reasoningTokens = optionalNumber(value.reasoningTokens);
    const cachedInputTokens = optionalNumber(value.cachedInputTokens);
    const estimatedCost = optionalNumber(value.estimatedCost);
    // Accept records written before escalated became an explicit semantic role.
    const usedEscalated =
        typeof value.usedEscalated === "boolean" ? value.usedEscalated : value.escalatedReasoning;
    const usedDeep = typeof value.usedDeep === "boolean" ? value.usedDeep : value.escalatedDeep;
    if (
        !taskId ||
        !preset ||
        !startingRole ||
        !highestRole ||
        !modelsUsed ||
        !thinkingLevelsUsed ||
        (value.modelUsage !== undefined && modelUsage === undefined) ||
        inputTokens === undefined ||
        outputTokens === undefined ||
        assistantFailures === undefined ||
        infrastructureFailures === undefined ||
        developmentFailures === undefined ||
        stagnationEvents === undefined ||
        correctionCount === undefined ||
        turns === undefined ||
        typeof usedEscalated !== "boolean" ||
        typeof usedDeep !== "boolean" ||
        typeof value.completed !== "boolean" ||
        (value.reasoningTokens !== undefined && reasoningTokens === undefined) ||
        (value.cachedInputTokens !== undefined && cachedInputTokens === undefined) ||
        (value.estimatedCost !== undefined && estimatedCost === undefined)
    ) {
        return undefined;
    }
    return {
        taskId,
        preset,
        startingRole,
        highestRole,
        modelsUsed,
        thinkingLevelsUsed,
        ...(modelUsage === undefined ? {} : { modelUsage }),
        inputTokens,
        outputTokens,
        ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
        ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
        ...(estimatedCost === undefined ? {} : { estimatedCost }),
        assistantFailures,
        infrastructureFailures,
        developmentFailures,
        stagnationEvents,
        correctionCount,
        usedEscalated,
        usedDeep,
        turns,
        completed: value.completed,
    };
}

export function decodeSessionUsageEntry(value: unknown): DashboardSessionEntry | undefined {
    if (!isRecord(value)) return undefined;
    if (value.type === "custom" && value.customType === "pidev:routing-task") {
        const task = decodeRoutingTaskMetrics(value.data);
        if (!task) return undefined;
        const timestamp =
            typeof value.timestamp === "string"
                ? finiteNumberOrZero(Date.parse(value.timestamp))
                : 0;
        return { type: "routing-task", task, timestamp };
    }
    if (value.type === "session") {
        return typeof value.id === "string" ? { type: "session", sessionId: value.id } : undefined;
    }
    if (value.type !== "message" || !isRecord(value.message)) return undefined;
    const message = value.message;
    if (
        message.role !== "assistant" ||
        typeof message.provider !== "string" ||
        typeof message.model !== "string" ||
        !isRecord(message.usage)
    ) {
        return undefined;
    }
    const usage = message.usage;
    const fallbackTimestamp =
        typeof value.timestamp === "string" ? finiteNumberOrZero(Date.parse(value.timestamp)) : 0;
    return {
        type: "message",
        message: {
            provider: message.provider,
            model: message.model,
            cost: isRecord(usage.cost) ? finiteNumberOrZero(usage.cost.total) : 0,
            input: finiteNumberOrZero(usage.input),
            output: finiteNumberOrZero(usage.output),
            cacheRead: finiteNumberOrZero(usage.cacheRead),
            cacheWrite: finiteNumberOrZero(usage.cacheWrite),
            timestamp: finiteNumberOrZero(message.timestamp) || fallbackTimestamp,
        },
    };
}

/** Aggregate persisted routing records without retaining prompt or tool-output content. */
export function summarizeRoutingTasks(tasks: readonly DashboardRoutingTask[]): RoutingTaskSummary {
    const summary: RoutingTaskSummary = {
        tasks: 0,
        completed: 0,
        startedFast: 0,
        startedBase: 0,
        fastToBase: 0,
        escalatedRecoveries: 0,
        deepRecoveries: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        estimatedCost: 0,
        costPerSuccess: 0,
        corrections: 0,
        stagnationEvents: 0,
        assistantFailures: 0,
        infrastructureFailures: 0,
        developmentFailures: 0,
        models: [],
    };
    const modelStats = new Map<string, { summary: RoutingModelSummary; taskIds: Set<string> }>();
    const seenTaskIds = new Set<string>();
    for (const { task } of tasks) {
        if (seenTaskIds.has(task.taskId)) continue;
        seenTaskIds.add(task.taskId);
        summary.tasks++;
        if (task.completed) summary.completed++;
        if (task.startingRole === "fast") summary.startedFast++;
        if (task.startingRole === "base") summary.startedBase++;
        if (
            task.startingRole === "fast" &&
            (task.highestRole === "base" || task.usedEscalated || task.usedDeep)
        ) {
            summary.fastToBase++;
        }
        if (task.usedEscalated) summary.escalatedRecoveries++;
        if (task.usedDeep) summary.deepRecoveries++;
        summary.inputTokens += task.inputTokens;
        summary.outputTokens += task.outputTokens;
        summary.reasoningTokens += task.reasoningTokens ?? 0;
        summary.cachedInputTokens += task.cachedInputTokens ?? 0;
        summary.estimatedCost += task.estimatedCost ?? 0;
        summary.corrections += task.correctionCount;
        summary.stagnationEvents += task.stagnationEvents;
        summary.assistantFailures += task.assistantFailures;
        summary.infrastructureFailures += task.infrastructureFailures;
        summary.developmentFailures += task.developmentFailures;

        const byModel =
            task.modelUsage ??
            task.modelsUsed.map((model) => ({
                model,
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cachedInputTokens: 0,
                estimatedCost: 0,
            }));
        for (const usage of byModel) {
            let stats = modelStats.get(usage.model);
            if (!stats) {
                stats = {
                    summary: {
                        model: usage.model,
                        tasks: 0,
                        completed: 0,
                        estimatedCost: 0,
                        costPerSuccess: 0,
                    },
                    taskIds: new Set(),
                };
                modelStats.set(usage.model, stats);
            }
            if (!stats.taskIds.has(task.taskId)) {
                stats.taskIds.add(task.taskId);
                stats.summary.tasks++;
                if (task.completed) stats.summary.completed++;
            }
            stats.summary.estimatedCost += usage.estimatedCost;
        }
    }
    summary.costPerSuccess = summary.completed > 0 ? summary.estimatedCost / summary.completed : 0;
    summary.models = Array.from(modelStats.values())
        .map(({ summary: model }) => ({
            ...model,
            costPerSuccess: model.completed > 0 ? model.estimatedCost / model.completed : 0,
        }))
        .sort((a, b) => b.estimatedCost - a.estimatedCost || a.model.localeCompare(b.model));
    return summary;
}
