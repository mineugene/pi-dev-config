import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";
import registerInlineReferences, { parseInlineReferences } from "./index.ts";

describe("parseInlineReferences", () => {
    test("parses skill and prompt references", () => {
        expect(parseInlineReferences("use $skill:handoff then $prompt:review")).toEqual([
            { kind: "skill", name: "handoff", raw: "$skill:handoff" },
            { kind: "prompt", name: "review", raw: "$prompt:review" },
        ]);
    });

    test("requires token boundary and strips trailing punctuation", () => {
        expect(parseInlineReferences("cost is $5, use($skill:nope) and $skill:triage.")).toEqual([
            { kind: "skill", name: "triage", raw: "$skill:triage" },
        ]);
    });

    test("dedupes by kind and name", () => {
        expect(parseInlineReferences("$skill:triage $skill:triage $prompt:triage")).toEqual([
            { kind: "skill", name: "triage", raw: "$skill:triage" },
            { kind: "prompt", name: "triage", raw: "$prompt:triage" },
        ]);
    });

    test("opens full skill instructions from /skill-info", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pidev-skill-info-"));
        const filePath = join(dir, "SKILL.md");
        writeFileSync(
            filePath,
            "---\nname: demo\ndescription: Demo skill\n---\n\n# Usage\n\n`demo <required>`\n",
        );

        let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
        const pi = {
            registerCommand(name: string, definition: { handler: typeof handler }) {
                if (name === "skill-info") handler = definition.handler;
            },
            on: vi.fn(),
        };
        registerInlineReferences(pi as unknown as Parameters<typeof registerInlineReferences>[0]);

        const editor = vi.fn(async () => undefined);
        try {
            await handler?.("demo", {
                mode: "tui",
                getSystemPromptOptions: () => ({
                    skills: [
                        {
                            name: "demo",
                            description: "Demo skill",
                            filePath,
                            baseDir: dir,
                        },
                    ],
                }),
                ui: { editor, notify: vi.fn(), select: vi.fn() },
            });
            expect(editor).toHaveBeenCalledWith(
                "Skill: demo (view only; Esc closes)",
                "Demo skill\n\n# Usage\n\n`demo <required>`",
            );
        } finally {
            rmSync(dir, { force: true, recursive: true });
        }
    });
});
