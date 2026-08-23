import { type ExtensionAPI, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";

import { formatContextAudit } from "../domain/context-audit.ts";

function textContent(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** Inspect the current Pi prompt inputs and session without making a model request. */
export default function registerContextAudit(pi: ExtensionAPI): void {
    let latestEffectivePrompt: string | undefined;
    pi.on("before_agent_start", (event) => {
        latestEffectivePrompt = event.systemPrompt;
    });
    pi.on("session_start", () => {
        latestEffectivePrompt = undefined;
    });

    pi.registerCommand("context-audit", {
        description: "Show the current prompt, tool, and conversation footprint.",
        handler: async (_args, ctx) => {
            const options = ctx.getSystemPromptOptions();
            const systemPrompt = latestEffectivePrompt ?? ctx.getSystemPrompt();
            const entries = ctx.sessionManager.buildContextEntries();
            const messages = { user: 0, assistant: 0, toolResults: 0 };
            const compactionCount = ctx.sessionManager
                .getBranch()
                .filter((entry) => entry.type === "compaction").length;
            for (const entry of entries) {
                if (entry.type !== "message") continue;
                if (entry.message.role === "user") messages.user++;
                if (entry.message.role === "assistant") messages.assistant++;
                if (entry.message.role === "toolResult") messages.toolResults++;
            }
            const activeTools = pi.getActiveTools();
            const advertisedSkills = activeTools.includes("read")
                ? (options.skills ?? []).filter((skill) => !skill.disableModelInvocation)
                : [];
            const allTools = pi.getAllTools();
            const activeToolSchemaChars = allTools
                .filter((tool) => activeTools.includes(tool.name))
                .reduce(
                    (sum, tool) =>
                        sum +
                        JSON.stringify({
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parameters,
                        }).length,
                    0,
                );
            const report = formatContextAudit({
                systemPrompt,
                systemPromptSource: latestEffectivePrompt
                    ? "latest observed turn"
                    : "base (no turn observed)",
                contextFiles: (options.contextFiles ?? []).map((file) => ({
                    path: file.path,
                    content: textContent(file.content),
                })),
                injectedFeatureBlocks: [
                    systemPrompt.includes("## Response style: caveman-lite")
                        ? "caveman"
                        : undefined,
                    systemPrompt.includes("<pi-dev-config-ponytail>") ? "ponytail" : undefined,
                    systemPrompt.includes("## Graphify graph-use policy") ? "graphify" : undefined,
                ].filter((name): name is string => name !== undefined),
                skills: advertisedSkills.map((skill) => ({ name: skill.name })),
                advertisedSkillPromptChars: formatSkillsForPrompt(advertisedSkills).length,
                activeTools,
                activeToolSchemaChars,
                deferredToolCount: allTools.filter((tool) => !activeTools.includes(tool.name))
                    .length,
                messages,
                contextTokens: ctx.getContextUsage()?.tokens ?? null,
                compactionCount,
                model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none",
                thinkingLevel: ctx.thinkingLevel ?? "off",
            });
            ctx.ui.notify(report, "info");
        },
    });
}
