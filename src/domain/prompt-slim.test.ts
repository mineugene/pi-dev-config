import { describe, expect, it } from "vitest";

import { isPiHelpPrompt, stripPiDocumentation } from "./prompt-slim.ts";

const DOCS = `Pi documentation (read only when the user asks about pi itself):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

describe("Pi prompt slimming", () => {
    it("removes only the generic Pi documentation block", () => {
        expect(
            stripPiDocumentation(`tools\n\n${DOCS}\n\n<project_context>rules</project_context>`),
        ).toBe("tools\n\n<project_context>rules</project_context>");
    });

    it("is idempotent and fails open when the block shape is unknown", () => {
        expect(stripPiDocumentation(stripPiDocumentation(DOCS))).toBe("");
        expect(stripPiDocumentation("Pi documentation changed upstream")).toBe(
            "Pi documentation changed upstream",
        );
    });

    it("recognises explicit Pi help but not ordinary coding prompts", () => {
        expect(isPiHelpPrompt("Pi help request: how do extensions work?")).toBe(true);
        expect(isPiHelpPrompt("fix the TypeScript build")).toBe(false);
    });
});
