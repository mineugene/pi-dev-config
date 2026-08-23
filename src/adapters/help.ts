/**
 * `/help` menu.
 *
 * Shows an overlay with the two things this config makes non-obvious:
 *   1. which editor Ctrl+G will open for the current prompt (resolved the same
 *      way pi resolves it: externalEditor setting, then $VISUAL, then $EDITOR,
 *      then nano / Notepad), and
 *   2. the active keybindings, read live from ~/.pi/agent/keybindings.json and
 *      annotated with what each one does.
 *
 * pi's own `/hotkeys` lists every default shortcut; this is the curated cheat
 * sheet for the vim bindings and the extras this package adds.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    CONFIG_DIR_NAME,
    DynamicBorder,
    type ExtensionAPI,
    type ExtensionCommandContext,
    getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Text } from "@earendil-works/pi-tui";

/** Human-readable labels for the keybinding ids this config cares about. */
const BINDING_LABELS: Record<string, string> = {
    "tui.editor.cursorUp": "cursor up",
    "tui.editor.cursorDown": "cursor down",
    "tui.editor.cursorLeft": "cursor left",
    "tui.editor.cursorRight": "cursor right",
    "tui.editor.cursorWordLeft": "word left",
    "tui.editor.cursorWordRight": "word right",
    "tui.editor.cursorLineStart": "line start",
    "tui.editor.cursorLineEnd": "line end",
    "tui.editor.deleteWordBackward": "delete word back",
    "tui.editor.deleteWordForward": "delete word forward",
    "tui.editor.deleteToLineStart": "delete to line start",
    "tui.editor.deleteToLineEnd": "delete to line end",
    "tui.input.newLine": "new line",
};

function readJson(path: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/** Resolve which editor Ctrl+G opens, mirroring pi's own precedence. */
function resolveEditor(cwd: string): string {
    const global = readJson(join(getAgentDir(), "settings.json")).externalEditor;
    const project = readJson(join(cwd, CONFIG_DIR_NAME, "settings.json")).externalEditor;
    const fromSettings =
        typeof project === "string" ? project : typeof global === "string" ? global : undefined;
    const fallback = process.platform === "win32" ? "notepad" : "nano";
    return fromSettings ?? process.env.VISUAL ?? process.env.EDITOR ?? fallback;
}

function readKeybindings(): Record<string, string[]> {
    const raw = readJson(join(getAgentDir(), "keybindings.json"));
    const out: Record<string, string[]> = {};
    for (const [id, keys] of Object.entries(raw)) {
        if (Array.isArray(keys))
            out[id] = keys.filter((key): key is string => typeof key === "string");
        else if (typeof keys === "string") out[id] = [keys];
    }
    return out;
}

function helpText(cwd: string): string[] {
    const lines: string[] = [];
    lines.push("pi-dev-config");
    lines.push("");
    lines.push(`Ctrl+G opens prompt in: ${resolveEditor(cwd)}`);
    lines.push("");

    const bindings = readKeybindings();
    const ids = Object.keys(bindings);
    if (ids.length === 0) {
        lines.push("Keybindings: none set (~/.pi/agent/keybindings.json missing).");
    } else {
        lines.push("Keybindings (from ~/.pi/agent/keybindings.json):");
        for (const id of ids) {
            const label = BINDING_LABELS[id] ?? id;
            lines.push(`  ${(bindings[id] ?? []).join(", ").padEnd(28)} ${label}`);
        }
    }

    lines.push("");
    lines.push("This config also adds:");
    lines.push("  @<query>       fff file/dir mentions (spaces + paths outside cwd)");
    lines.push("  @file:10-20    expand a line range into context");
    lines.push("  $skill:/$prompt:  attach a skill or prompt as hidden context");
    lines.push("  grep/find      fff content and path search");
    lines.push("  /todos         show the current plan to-do list");
    lines.push("  /skill-info    browse full skill docs and argument usage");
    lines.push("  /effort        select effort; /effort <level> sets it directly");
    lines.push("  /agents        subagent fleet list + conversation viewer");
    lines.push("  /rollback      restore files from an edit/write checkpoint");
    lines.push("  /usage         cost/token dashboard");
    lines.push("  /pi-sessions   focus a tracked Pi pane");
    lines.push("  /next-session  focus the next pane needing attention");
    lines.push("  /hotkeys       pi's full default shortcut list");
    lines.push("  alt+e          select model effort level");
    lines.push("  ctrl+shift+y   toggle bash-gate yolo mode");
    lines.push("  ctrl+shift+n   focus next tracked Pi pane");
    return lines;
}

async function showOverlay(ctx: ExtensionCommandContext): Promise<void> {
    const lines = helpText(ctx.cwd);
    await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
            const container = new Container();
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
            for (const [index, line] of lines.entries()) {
                const styled = index === 0 ? theme.fg("accent", theme.bold(line)) : line;
                container.addChild(new Text(styled, 1, 0));
            }
            container.addChild(new Text(theme.fg("dim", "esc / enter / q to close"), 1, 0));
            container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
            return {
                render: (width: number) => container.render(width),
                invalidate: () => container.invalidate(),
                handleInput: (data: string) => {
                    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q")
                        done();
                    tui.requestRender();
                },
            };
        },
        { overlay: true },
    );
}

export default function registerHelp(pi: ExtensionAPI): void {
    pi.registerCommand("help", {
        description: "Show pi-dev-config keybindings and which editor Ctrl+G opens",
        handler: async (_args, ctx) => {
            if (ctx.mode === "tui") {
                await showOverlay(ctx);
            } else {
                ctx.ui.notify(helpText(ctx.cwd).join("\n"), "info");
            }
        },
    });
}
