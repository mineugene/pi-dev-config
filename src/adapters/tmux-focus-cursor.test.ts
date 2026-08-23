import { CURSOR_MARKER, type EditorComponent, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { hideCursor, wrapEditor } from "./tmux-focus-cursor.ts";

/** The pi-tui 1.0.x fake cursor: a reverse-video cell. */
function reverseVideo(character: string): string {
    return `\x1b[7m${character}\x1b[0m`;
}

function cursorLine(): string {
    return `a${CURSOR_MARKER}${reverseVideo("b")}c`;
}

function fakeEditor(): EditorComponent {
    return {
        render: () => [cursorLine()],
        invalidate: vi.fn(),
        getText: () => "abc",
        setText: vi.fn(),
        handleInput: vi.fn(),
    };
}

describe("hideCursor", () => {
    it("strips a reverse-video cursor, keeping the character", () => {
        expect(hideCursor(cursorLine())).toBe("abc");
    });

    it("strips newer APC fake-cursor markers", () => {
        expect(hideCursor("a\x1b_pi:fc\x07b\x1b_pi:/fc\x07c")).toBe("abc");
    });

    it("drops a trailing cursor space", () => {
        expect(hideCursor(`a${reverseVideo(" ")}`)).toBe("a");
    });

    it("leaves ordinary lines untouched", () => {
        expect(hideCursor("plain text")).toBe("plain text");
    });
});

describe("focus-aware editor wrapper", () => {
    it("hides the cursor only while unfocused", () => {
        const inner = fakeEditor();
        const tui = { requestRender: vi.fn() } as unknown as TUI;
        const { editor, setFocused } = wrapEditor(inner, tui);

        expect(editor.render(10)).toEqual([cursorLine()]);

        setFocused(false);
        expect(editor.render(10)).toEqual(["abc"]);
        expect(inner.invalidate).toHaveBeenCalled();
        expect(tui.requestRender).toHaveBeenCalled();

        setFocused(true);
        expect(editor.render(10)).toEqual([cursorLine()]);
    });

    it("forwards member reads and writes to the wrapped editor", () => {
        const inner = fakeEditor();
        const { editor } = wrapEditor(inner, { requestRender: vi.fn() } as unknown as TUI);

        expect(editor.getText()).toBe("abc");
        const onSubmit = (text: string): void => void text;
        editor.onSubmit = onSubmit;
        expect(inner.onSubmit).toBe(onSubmit);
    });
});
