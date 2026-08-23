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
            "Code comments (apply even when response style is off):",
        );
        expect(result?.systemPrompt).toContain("Never use code comments to narrate the patch");
        expect(result?.systemPrompt).toContain(
            "Keep change summaries in the response, not in source files.",
        );
        expect(result?.systemPrompt).toContain("The code-comment rules above still apply.");
        expect(await handler({ systemPrompt: result?.systemPrompt ?? "" })).toBeUndefined();
    });
});
