/**
 * Pure helpers over pi's message log. Type-only dependency on the pi API (no
 * runtime import), so this stays in the domain ring and unit-tests without a
 * harness.
 */

import type { AgentEndEvent } from "@earendil-works/pi-coding-agent";

/** Trimmed text of the last assistant message with any, for notifications. */
export function extractLastAssistantText(messages: AgentEndEvent["messages"]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role !== "assistant") continue;
        const text = message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
            .trim();
        if (text) return text;
    }
    return undefined;
}
