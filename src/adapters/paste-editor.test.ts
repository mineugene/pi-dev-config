import { describe, expect, it } from "vitest";

import { PasteEditor } from "./paste-editor.ts";

function createEditor(): PasteEditor {
    const tui = { requestRender() {} } as unknown as ConstructorParameters<typeof PasteEditor>[0];
    const theme = {
        borderColor: (text: string) => text,
        selectList: {},
    } as unknown as ConstructorParameters<typeof PasteEditor>[1];
    const keybindings = {
        matches: () => false,
    } as unknown as ConstructorParameters<typeof PasteEditor>[2];
    return new PasteEditor(tui, theme, keybindings);
}

describe("PasteEditor", () => {
    it("expands condensed paste markers on submission", () => {
        const editor = createEditor();
        const pasted = "first line\nsecond line\nthird line";
        let submitted: string | undefined;
        editor.onSubmit = (text) => {
            submitted = text;
        };

        editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
        expect(editor.getText()).toBe("[Pasted text #1 +3 lines]");

        editor.handleInput("\r");

        expect(submitted).toBe(pasted);
        expect(editor.getText()).toBe("");
    });
});
