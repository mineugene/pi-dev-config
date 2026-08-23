import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import registerCaveman from "./caveman.ts";

describe("caveman prompt", () => {
    it("injects code-comment rules that apply independently of response style", async () => {
        let handler:
            | ((event: { systemPrompt: string }) => Promise<{ systemPrompt: string } | undefined>)
            | undefined;
        registerCaveman({
            on: (event: string, callback: typeof handler) => {
                if (event === "before_agent_start") handler = callback;
            },
        } as unknown as ExtensionAPI);
        if (!handler) throw new Error("before_agent_start handler was not registered");

        const result = await handler({ systemPrompt: "Base prompt" });
        expect(result?.systemPrompt).toContain("Base prompt");
        expect(result?.systemPrompt).toContain(
            "Code comments (always active, even when caveman-lite is off):",
        );
        expect(result?.systemPrompt).toContain(
            "Write timeless comments for a reader who sees only the finished code, never the diff.",
        );
        expect(result?.systemPrompt).toContain(
            "Put change narration and before/after explanations in the response or commit message, never in a source file.",
        );
        expect(result?.systemPrompt).toContain(
            "Plain language (always active, even when caveman-lite is off):",
        );
        expect(result?.systemPrompt).toContain(
            "Write for the reader: keep content relevant, findable, understandable, and usable.",
        );
        expect(result?.systemPrompt).toContain("The code-comment rules above still apply.");
        expect(await handler({ systemPrompt: result?.systemPrompt ?? "" })).toBeUndefined();
    });
});
