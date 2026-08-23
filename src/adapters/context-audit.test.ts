import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerContextAudit from "./context-audit.ts";

describe("/context-audit", () => {
    it("reports runtime data without starting a model turn", async () => {
        let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
        let beforeAgentStart: ((event: { systemPrompt: string }) => void) | undefined;
        const sendUserMessage = vi.fn();
        const notify = vi.fn();
        const pi = {
            registerCommand: (_name: string, command: { handler: typeof handler }) => {
                handler = command.handler;
            },
            on: (event: string, eventHandler: typeof beforeAgentStart) => {
                if (event === "before_agent_start") beforeAgentStart = eventHandler;
            },
            getActiveTools: () => ["read"],
            getAllTools: () => [
                { name: "read", description: "Read a file", parameters: { type: "object" } },
                { name: "commit", description: "Commit", parameters: { type: "object" } },
            ],
            sendUserMessage,
        } as unknown as ExtensionAPI;
        registerContextAudit(pi);
        if (!handler) throw new Error("context-audit command was not registered");
        beforeAgentStart?.({
            systemPrompt:
                "final prompt\n\n## Response style: caveman-lite\n\n<pi-dev-config-ponytail>",
        });

        await handler("", {
            getSystemPrompt: () => "system prompt",
            getSystemPromptOptions: () => ({
                contextFiles: [{ path: "AGENTS.md", content: "rules" }],
                skills: [
                    {
                        name: "tdd",
                        description: "Test first.",
                        filePath: "/skills/tdd/SKILL.md",
                        disableModelInvocation: false,
                    },
                    {
                        name: "handoff",
                        description: "Manual handoff.",
                        filePath: "/skills/handoff/SKILL.md",
                        disableModelInvocation: true,
                    },
                ],
            }),
            getContextUsage: () => ({ tokens: 42, contextWindow: 1_000, percent: 4.2 }),
            thinkingLevel: "low",
            model: { provider: "test", id: "model" },
            sessionManager: {
                buildContextEntries: () => [
                    { type: "message", message: { role: "user", content: "hello" } },
                    { type: "message", message: { role: "toolResult", content: [] } },
                ],
                getBranch: () => [{ type: "compaction" }],
            },
            ui: { notify },
        } as unknown as ExtensionCommandContext);

        expect(sendUserMessage).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledOnce();
        expect(notify.mock.calls[0]?.[0]).toContain(
            "injected feature blocks 2 (caveman, ponytail)",
        );
        expect(notify.mock.calls[0]?.[0]).toContain("advertised skills       1");
        expect(notify.mock.calls[0]?.[0]).toContain("current context         42 estimate");
        expect(notify.mock.calls[0]?.[0]).toContain("deferred/inactive count 1");
    });
});
