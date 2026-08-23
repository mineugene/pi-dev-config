import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const EFFORT_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const satisfies readonly ThinkingLevel[];

const EFFORT_LEVEL_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);

export function isEffortLevel(value: unknown): value is ThinkingLevel {
    return typeof value === "string" && EFFORT_LEVEL_SET.has(value);
}

export function parseEffortLevel(input: string): ThinkingLevel | undefined {
    const normalized = input.trim().toLowerCase();
    return isEffortLevel(normalized) ? normalized : undefined;
}
