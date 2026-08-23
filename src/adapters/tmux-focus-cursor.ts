/**
 * Hide pi's editor cursor while its tmux pane is unfocused.
 *
 * tmux draws only the active pane's hardware cursor, but pi's editor also paints
 * a reverse-video fake cursor, which stays visible in the inactive pane. This
 * wraps the active editor and strips the cursor markers whenever the pane loses
 * focus.
 *
 * Enable in pidev.json: { "tmuxFocusCursor": { "enabled": true } }
 *
 * tmux focus state is polled because pi's TUI consumes terminal focus reports
 * before extension input listeners can observe them.
 */

import {
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type EditorComponent, type TUI } from "@earendil-works/pi-tui";

import type { PiDevConfig } from "../infra/config.ts";
import { createTmux } from "../infra/tmux.ts";

const POLL_INTERVAL_MS = 500;

// pi-tui 1.0.x draws the fake cursor as a reverse-video cell; newer pi-tui wraps
// the cell in these zero-width APC markers. CURSOR_MARKER (exported) precedes
// either when the editor is focused.
const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";
const REVERSE_VIDEO_ON = "\x1b[7m";
const REVERSE_VIDEO_OFF = ["\x1b[0m", "\x1b[27m"];

/** Unwrap the first reverse-video cell (the fake cursor), keeping its text. */
function stripReverseVideo(line: string): string {
    const start = line.indexOf(REVERSE_VIDEO_ON);
    if (start === -1) return line;
    const contentStart = start + REVERSE_VIDEO_ON.length;
    const closers = REVERSE_VIDEO_OFF.map((sequence) => ({
        at: line.indexOf(sequence, contentStart),
        length: sequence.length,
    }))
        .filter((closer) => closer.at !== -1)
        .sort((a, b) => a.at - b.at);
    const closer = closers[0];
    if (!closer) return line;
    const character = line.slice(contentStart, closer.at);
    const trailing = line.slice(closer.at + closer.length);
    const replacement = character === " " && /^\s*$/u.test(trailing) ? "" : character;
    return line.slice(0, start) + replacement + trailing;
}

/** Remove the cursor markers so the cursor cell renders as ordinary text. */
export function hideCursor(line: string): string {
    const stripped = line
        .replaceAll(CURSOR_MARKER, "")
        .replaceAll(FAKE_CURSOR_START, "")
        .replaceAll(FAKE_CURSOR_END, "");
    return stripReverseVideo(stripped);
}

interface FocusAwareEditor {
    /** Behaves like the wrapped editor; only `render` is intercepted. */
    readonly editor: EditorComponent;
    setFocused(focused: boolean): void;
}

export function wrapEditor(inner: EditorComponent, tui: TUI): FocusAwareEditor {
    let tmuxFocused = true;
    const render = (width: number): string[] => {
        const lines = inner.render(width);
        return tmuxFocused ? lines : lines.map(hideCursor);
    };
    // The Proxy forwards every member the host reads, writes, or checks with `in`
    // (`actionHandlers`, callbacks, optional methods) to the wrapped editor.
    const editor = new Proxy(inner, {
        get(target, property, receiver) {
            if (property === "render") return render;
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return {
        editor,
        setFocused(focused) {
            if (tmuxFocused === focused) return;
            tmuxFocused = focused;
            inner.invalidate();
            tui.requestRender();
        },
    };
}

export default function registerTmuxFocusCursor(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    let timer: ReturnType<typeof setInterval> | undefined;

    function stop(): void {
        if (timer) clearInterval(timer);
        timer = undefined;
    }

    pi.on("session_shutdown", stop);

    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
        stop();
        if (ctx.mode !== "tui") return;
        if (configRef.current.tmuxFocusCursor?.enabled !== true) return;
        const paneId = process.env.TMUX_PANE ?? "";
        if (paneId === "") return;

        const tmux = createTmux();
        const previous = ctx.ui.getEditorComponent();
        let focused = await tmux.isPaneFocused(paneId);
        let wrapper: FocusAwareEditor | undefined;

        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
            const inner = previous
                ? previous(tui, theme, keybindings)
                : new CustomEditor(tui, theme, keybindings);
            wrapper = wrapEditor(inner, tui);
            wrapper.setFocused(focused);
            return wrapper.editor;
        });

        async function poll(): Promise<void> {
            const next = await tmux.isPaneFocused(paneId);
            if (next === focused) return;
            focused = next;
            wrapper?.setFocused(next);
        }

        timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
        timer.unref?.();
    });
}
