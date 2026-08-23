import { truncateHead } from "../../domain/text.ts";
import type { AgentRecord } from "./types.ts";
import { type AgentDetails, formatTokens } from "./ui/agent-format.ts";
import { buildDoneStats } from "./ui/tool-call-format.ts";
import { getLifetimeTotal, type LifetimeUsage } from "./usage.ts";

const MAX_AGENT_TOOL_RESULT_CHARS = 50_000;
const AGENT_RESULT_TRUNCATION_MARKER =
    "\n\n[Agent output truncated. Open its transcript or conversation viewer for the full result.]";

/** Tool execute return value for a bounded text response. */
export function textResult<const TDetails = AgentDetails>(msg: string, details?: TDetails) {
    return {
        content: [
            {
                type: "text" as const,
                text: truncateHead(
                    msg,
                    MAX_AGENT_TOOL_RESULT_CHARS,
                    AGENT_RESULT_TRUNCATION_MARKER,
                ),
            },
        ],
        details,
    };
}

/** Format an agent's lifetime token total, or "" when zero. */
export function formatLifetimeTokens(o: { lifetimeUsage: LifetimeUsage }): string {
    const t = getLifetimeTotal(o.lifetimeUsage);
    return t > 0 ? formatTokens(t) : "";
}

/** Build AgentDetails from a base + record-specific fields. */
export function buildDetails(
    base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
    record: AgentRecord,
    activity?: { turnCount?: number; toolCalls?: string[] },
    overrides?: Partial<AgentDetails>,
): AgentDetails {
    return {
        ...base,
        toolUses: record.toolUses,
        tokens: formatLifetimeTokens(record),
        ...(activity?.turnCount !== undefined ? { turnCount: activity.turnCount } : {}),
        durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
        status: record.status as AgentDetails["status"],
        agentId: record.id,
        ...(record.error !== undefined ? { error: record.error } : {}),
        ...(activity?.toolCalls !== undefined ? { toolCalls: activity.toolCalls } : {}),
        lifetimeUsage: record.lifetimeUsage,
        ...overrides,
    };
}

export function doneStats(toolCalls: number, usage: LifetimeUsage, durationMs?: number): string {
    return buildDoneStats(toolCalls, usage, durationMs);
}
