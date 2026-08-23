/**
 * Registers the paste-collapsing editor (see paste-editor.ts) as the input
 * component. Stands down when the modal vim editor is active, because VimEditor
 * extends PasteEditor and would be overwritten by a later setEditorComponent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PasteEditor } from "./paste-editor.ts";

export default function registerPaste(pi: ExtensionAPI, vimActive: () => boolean): void {
    pi.on("session_start", async (_event, ctx) => {
        if (ctx.mode !== "tui" || vimActive()) return;
        ctx.ui.setEditorComponent(
            (tui, theme, keybindings) => new PasteEditor(tui, theme, keybindings),
        );
    });
}
