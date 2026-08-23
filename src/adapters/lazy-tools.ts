import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { addDeferredTools, searchDeferredTools } from "../domain/lazy-tools.ts";

export const DEFERRED_TOOL_NAMES = [
    "Agent",
    "todo",
    "commit",
    "ask_user_question",
    "get_subagent_result",
    "steer_subagent",
] as const;

const DEFERRED_TOOL_KEYWORDS: Readonly<
    Record<(typeof DEFERRED_TOOL_NAMES)[number], readonly string[]>
> = {
    Agent: ["subagent", "delegate", "delegation", "background", "parallel"],
    todo: ["plan", "planning", "tasks", "checklist"],
    commit: ["git", "signed", "stage", "signing"],
    ask_user_question: ["question", "clarify", "choice", "decision", "ask"],
    get_subagent_result: ["subagent", "agent", "background", "result", "status"],
    steer_subagent: ["subagent", "agent", "background", "steer", "redirect"],
};

export default function registerLazyTools(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "search_tools",
        label: "Search Tools",
        description: "Find and enable deferred tools for a task.",
        promptSnippet: "Find and enable deferred tools",
        parameters: Type.Object({
            query: Type.String({
                maxLength: 120,
                description: "Task capability to find.",
            }),
        }),
        async execute(_toolCallId, params) {
            const allTools = pi.getAllTools();
            const available = new Map(allTools.map((tool) => [tool.name, tool]));
            const catalogue = DEFERRED_TOOL_NAMES.flatMap((name) => {
                const tool = available.get(name);
                return tool
                    ? [
                          {
                              name,
                              description: tool.description,
                              keywords: DEFERRED_TOOL_KEYWORDS[name],
                          },
                      ]
                    : [];
            });
            const matches = searchDeferredTools(params.query, catalogue);
            if (matches.length === 0) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `No deferred tools match "${params.query}". Try agent, plan, commit, question, result, or steer.`,
                        },
                    ],
                    details: { matches: [], added: [] },
                };
            }

            const active = pi.getActiveTools();
            const added = matches.filter((name) => !active.includes(name));
            if (added.length > 0) pi.setActiveTools(addDeferredTools(active, added));
            return {
                content: [
                    {
                        type: "text" as const,
                        text: added.length
                            ? `Enabled: ${added.join(", ")}.`
                            : `Already enabled: ${matches.join(", ")}.`,
                    },
                ],
                details: { matches, added },
            };
        },
    });

    pi.on("session_start", (_event, ctx) => {
        const restored: string[] = [];
        for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
            if (entry.message.toolName !== "search_tools") continue;
            const details = entry.message.details;
            if (typeof details !== "object" || details === null || !("added" in details)) continue;
            if (!Array.isArray(details.added)) continue;
            const added: unknown[] = details.added;
            restored.push(
                ...added.filter(
                    (name): name is string =>
                        typeof name === "string" &&
                        DEFERRED_TOOL_NAMES.includes(name as (typeof DEFERRED_TOOL_NAMES)[number]),
                ),
            );
        }
        const available = new Set(pi.getAllTools().map((tool) => tool.name));
        const initiallyActive = pi
            .getActiveTools()
            .filter(
                (name) =>
                    !DEFERRED_TOOL_NAMES.includes(name as (typeof DEFERRED_TOOL_NAMES)[number]),
            );
        pi.setActiveTools(
            addDeferredTools(initiallyActive, [
                "search_tools",
                ...restored.filter((name) => available.has(name)),
            ]),
        );
    });
}
