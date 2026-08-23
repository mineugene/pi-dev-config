import { describe, expect, it } from "vitest";

import { formatContextAudit } from "./context-audit.ts";

describe("context audit", () => {
    it("labels character-derived values as estimates", () => {
        const report = formatContextAudit({
            systemPrompt: "abcd",
            systemPromptSource: "latest observed turn",
            contextFiles: [{ path: "AGENTS.md", content: "rules" }],
            injectedFeatureBlocks: ["caveman", "ponytail"],
            skills: [{ name: "tdd" }],
            advertisedSkillPromptChars: 10,
            activeTools: ["read"],
            activeToolSchemaChars: 400,
            deferredToolCount: 2,
            messages: { user: 1, assistant: 2, toolResults: 3 },
            contextTokens: 321,
            compactionCount: 1,
            model: "provider/model",
            thinkingLevel: "high",
        });

        expect(report).toContain("System prompt\n  source              latest observed turn");
        expect(report).toContain("estimate (chars/4)  1");
        expect(report).toContain("AGENTS/context files    1 (2 estimate)");
        expect(report).toContain("injected feature blocks 2 (caveman, ponytail)");
        expect(report).toContain("active tool count       1");
        expect(report).toContain("active schemas          100 estimate");
        expect(report).toContain("deferred/inactive count 2");
        expect(report).toContain("user messages           1");
        expect(report).toContain("current context         321 estimate");
        expect(report).toContain("compaction count        1");
    });
});
