import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
    parseSubagentMetadata,
    SUBAGENT_METADATA_ENTRY,
    type SubagentMetadata,
} from "../subagents/agent-runner.ts";

export type BashGatePolicy = "deny" | "prompt";

/** Undefined means main agent; null means malformed subagent metadata. */
export function subagentMetadata(entries: SessionEntry[]): SubagentMetadata | null | undefined {
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
    return metadata.bashGatePolicy === "prompt" ? "prompt" : "deny";
}
