/**
 * Optional modal vim editor.
 *
 * Off by default; the vim-style keybindings.json already gives alt+hjkl motion
 * without modes. Enable true modal editing (normal / insert) in pidev.json:
 *
 *   { "vim": { "enabled": true } }
 *
 * Built on the documented CustomEditor contract: normal mode translates vim keys
 * into the escape sequences the base editor already understands, insert mode
 * passes everything straight through. The active mode shows in the status line.
 * Marked experimental because it cannot be exercised without a live terminal.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

import type { PiDevConfig } from "../infra/config.ts";
import { PasteEditor } from "./paste-editor.ts";

type Mode = "normal" | "insert";

// Escape sequences the base editor already interprets.
const SEQ = {
    left: "\x1b[D",
    right: "\x1b[C",
    up: "\x1b[A",
    down: "\x1b[B",
    home: "\x1b[H",
    end: "\x1b[F",
    del: "\x1b[3~",
    wordRight: "\x1b[1;5C",
    wordLeft: "\x1b[1;5D",
} as const;

class VimEditor extends PasteEditor {
    private mode: Mode = "insert";
    private onModeChange: (mode: Mode) => void;

    constructor(
        tui: ConstructorParameters<typeof PasteEditor>[0],
        theme: ConstructorParameters<typeof PasteEditor>[1],
        keybindings: ConstructorParameters<typeof PasteEditor>[2],
        onModeChange: (mode: Mode) => void,
    ) {
        super(tui, theme, keybindings);
        this.onModeChange = onModeChange;
    }

    private setMode(mode: Mode): void {
        if (this.mode === mode) return;
        this.mode = mode;
        this.onModeChange(mode);
    }

    override handleInput(data: string): void {
        // Bracketed paste must reach the paste editor untouched, even from
        // normal mode where printable characters are otherwise swallowed.
        if (this.isCollectingPaste() || data.includes("\x1b[200~")) {
            super.handleInput(data);
            return;
        }

        if (matchesKey(data, "escape")) {
            // From insert, Esc only leaves insert; it does not abort the agent.
            if (this.mode === "insert") {
                this.setMode("normal");
                return;
            }
            super.handleInput(data);
            return;
        }

        if (this.mode === "insert") {
            super.handleInput(data);
            return;
        }

        switch (data) {
            case "i":
                this.setMode("insert");
                return;
            case "a":
                super.handleInput(SEQ.right);
                this.setMode("insert");
                return;
            case "I":
                super.handleInput(SEQ.home);
                this.setMode("insert");
                return;
            case "A":
                super.handleInput(SEQ.end);
                this.setMode("insert");
                return;
            case "h":
                super.handleInput(SEQ.left);
                return;
            case "j":
                super.handleInput(SEQ.down);
                return;
            case "k":
                super.handleInput(SEQ.up);
                return;
            case "l":
                super.handleInput(SEQ.right);
                return;
            case "w":
            case "e":
                super.handleInput(SEQ.wordRight);
                return;
            case "b":
                super.handleInput(SEQ.wordLeft);
                return;
            case "0":
            case "^":
                super.handleInput(SEQ.home);
                return;
            case "$":
                super.handleInput(SEQ.end);
                return;
            case "x":
                super.handleInput(SEQ.del);
                return;
            default:
                break;
        }

        // Swallow other printable characters so they do not leak into the buffer;
        // pass control keys (Ctrl+C, etc.) through to the base editor.
        if (data.length === 1 && data.charCodeAt(0) >= 32) return;
        super.handleInput(data);
    }
}

export default function registerVim(pi: ExtensionAPI, configRef: { current: PiDevConfig }): void {
    pi.on("session_start", async (_event, ctx) => {
        if (!configRef.current.vim?.enabled || ctx.mode !== "tui") return;
        ctx.ui.setEditorComponent(
            (tui, theme, keybindings) =>
                new VimEditor(tui, theme, keybindings, (mode) => {
                    ctx.ui.setStatus(
                        "vim",
                        ctx.ui.theme.fg(mode === "normal" ? "accent" : "dim", `vim:${mode}`),
                    );
                }),
        );
        ctx.ui.setStatus("vim", ctx.ui.theme.fg("dim", "vim:insert"));
    });
}
