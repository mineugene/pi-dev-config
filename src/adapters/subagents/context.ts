/**
 * context.ts — Extract parent conversation context for subagent inheritance.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "../../domain/text.ts";

const MAX_PARENT_CONTEXT_CHARS = 64_000;
const EARLIER_CONTEXT_MARKER = "[Earlier parent context truncated.]\n\n";

type TextContent = { type: "text"; text?: unknown };

function isTextContent(content: unknown): content is TextContent {
    return (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "text"
    );
}

/** Extract text from a message content block array. */
export function extractText(content: unknown[]): string {
    return content
        .filter(isTextContent)
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .join("\n");
}

/**
 * Build a text representation of the parent conversation context.
 * Used when inherit_context is true to give the subagent visibility
 * into what has been discussed/done so far.
 */
export function buildParentContext(
    ctx: ExtensionContext,
    maxChars = MAX_PARENT_CONTEXT_CHARS,
): string {
    const entries = ctx.sessionManager.getBranch();
    if (entries.length === 0) return "";

    let latestCompaction = -1;
    for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index]?.type === "compaction") {
            latestCompaction = index;
            break;
        }
    }

    const relevantEntries = latestCompaction >= 0 ? entries.slice(latestCompaction) : entries;
    const parts: string[] = [];

    for (const entry of relevantEntries) {
        if (entry.type === "message") {
            const msg = entry.message;
            if (msg.role === "user") {
                const text =
                    typeof msg.content === "string" ? msg.content : extractText(msg.content);
                if (text.trim()) parts.push(`[User]: ${text.trim()}`);
            } else if (msg.role === "assistant") {
                const text = extractText(msg.content);
                if (text.trim()) parts.push(`[Assistant]: ${text.trim()}`);
            }
            // Skip toolResult messages — too verbose for context
        } else if (entry.type === "compaction") {
            // Include compaction summaries — they're already condensed
            if (entry.summary) {
                parts.push(`[Summary]: ${entry.summary}`);
            }
        }
    }

    if (parts.length === 0) return "";

    const prefix = `# Parent Conversation Context
The following is recent conversation history from the parent session.

`;
    const suffix = `

---
# Your Task (below)
`;
    const bodyBudget = Math.max(0, maxChars - prefix.length - suffix.length);
    const body = truncateTail(parts.join("\n\n"), bodyBudget, EARLIER_CONTEXT_MARKER);
    return truncateTail(prefix + body + suffix, maxChars, EARLIER_CONTEXT_MARKER);
}
