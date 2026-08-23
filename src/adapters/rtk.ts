import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

const RTK_COMMAND = process.env.RTK_PATH || "rtk";
const REWRITE_TIMEOUT_MS = 2_000;
const RTK_NO_HOOK_WARNING =
    "[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings";
const RTK_FIND_REWRITE = /\brtk\s+find(?:\s|$)/;
const BIOME_INVOCATION =
    /(?:^|[;&|]\s*)(?:(?:(?:npx|pnpm)(?:\s+exec)?\s+)?biome|npm\s+run\s+biome)(?:\s|$)/;
const BROKEN_BIOME_REWRITE = /\brtk\s+lint\s+(?!biome(?:\s|$))/;
const NATIVE_FIND_ONLY_SYNTAX =
    /(?:^|\s)(?:!|\\?[(),]|-(?:not|a|and|o|or|delete|exec(?:dir)?|fls|fprint0?|fprintf|ls|ok(?:dir)?|print0?|printf|prune|quit))(?=\s|$)/;

export function shouldSkipRtkRewrite(command: string, rewritten: string): boolean {
    return RTK_FIND_REWRITE.test(rewritten) && NATIVE_FIND_ONLY_SYNTAX.test(command);
}

/** RTK 0.49 drops Biome's executable name, making its otherwise native filter unrunnable. */
export function correctRtkRewrite(command: string, rewritten: string): string {
    if (!BIOME_INVOCATION.test(command)) return rewritten;
    return rewritten.replace(BROKEN_BIOME_REWRITE, "rtk lint biome ");
}

export function stripRtkNoHookWarning(raw: string): string {
    return raw
        .split(/(?<=\n)/)
        .filter((line) => line.replace(/\r?\n$/, "") !== RTK_NO_HOOK_WARNING)
        .join("");
}

export function createRtkNoHookWarningDataFilter(
    onData: (data: Buffer) => void,
): (data: Buffer) => void {
    let pending = "";

    return (data) => {
        pending += data.toString();
        const lines = pending.split(/(?<=\n)/);
        pending = pending.endsWith("\n") ? "" : (lines.pop() ?? "");

        for (const line of lines) {
            if (line.replace(/\r?\n$/, "") !== RTK_NO_HOOK_WARNING) onData(Buffer.from(line));
        }

        if (pending.length > RTK_NO_HOOK_WARNING.length + 2) {
            onData(Buffer.from(pending));
            pending = "";
        }
    };
}

const NOTICE_PREFIX = "RTK rewrite: ";
const NOTICE_SEPARATOR = " -> ";
const NOTICE_ARROW = "-> ";
/**
 * pi renders status notices through ThemedText (1 column of padding each side),
 * and its fullscreen transcript scrollbar reserves another column when always on.
 * Budget for both so a wrapped line fills the render width exactly instead of
 * overflowing into pi's own word wrap, which breaks at whatever space it can.
 */
const NOTICE_RESERVED_COLUMNS = 3;
const NOTICE_HANGING_INDENT = "    ";
/** Bash removes a backslash-newline pair, so a trailing ` \` rejoins the command. */
const NOTICE_CONTINUATION = " \\";

function terminalColumns(): number {
    return process.stdout.columns || Number(process.env.COLUMNS) || 80;
}

function cleanMessage(raw: string): string {
    return raw.replace(/\s+/g, " ").trim();
}

/**
 * Splits on whitespace outside quotes, so a break never lands inside a quoted
 * argument, where the shell would keep the backslash and change the command.
 */
function splitCommandAtoms(text: string): string[] {
    const atoms: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;

    for (const char of text) {
        if (quote === "'") {
            current += char;
            if (char === "'") quote = null;
            continue;
        }
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            current += char;
            escaped = true;
            continue;
        }
        if (quote === '"') {
            current += char;
            if (char === '"') quote = null;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            current += char;
            continue;
        }
        if (char === " " || char === "\t") {
            if (current !== "") atoms.push(current);
            current = "";
            continue;
        }
        current += char;
    }

    if (current !== "") atoms.push(current);
    return atoms;
}

/**
 * Fills a line up to `width`, marking every continued line with a trailing
 * backslash and indenting continuation lines by the hanging indent.
 */
function wrapNoticeLine(prefix: string, text: string, width: number): string[] {
    const atoms = splitCommandAtoms(cleanMessage(text));
    const lines: string[] = [];
    let linePrefix = prefix;
    let index = 0;

    while (index < atoms.length) {
        const remaining = atoms.slice(index).join(" ");
        if (linePrefix.length + remaining.length <= width) {
            lines.push(linePrefix + remaining);
            break;
        }

        const limit = width - NOTICE_CONTINUATION.length;
        let chunk = "";
        let used = 0;
        while (index + used < atoms.length) {
            const atom = atoms[index + used] ?? "";
            const candidate = chunk === "" ? atom : `${chunk} ${atom}`;
            if (linePrefix.length + candidate.length > limit) break;
            chunk = candidate;
            used++;
        }

        if (used === 0) {
            const atom = atoms[index] ?? "";
            const room = Math.max(1, limit - linePrefix.length);
            const head = atom.slice(0, room);
            lines.push(linePrefix + head + NOTICE_CONTINUATION);
            atoms[index] = atom.slice(head.length);
            if (atoms[index] === "") index++;
        } else {
            lines.push(linePrefix + chunk + NOTICE_CONTINUATION);
            index += used;
        }
        linePrefix = NOTICE_HANGING_INDENT;
    }

    return lines;
}

export function formatRewriteNotice(
    originalCommand: string,
    rewrittenCommand: string,
    columns = terminalColumns(),
): string {
    const content = columns - NOTICE_RESERVED_COLUMNS;
    const original = cleanMessage(originalCommand);
    const rewritten = cleanMessage(rewrittenCommand);
    const inline = `${NOTICE_PREFIX}${original}${NOTICE_SEPARATOR}${rewritten}`;

    if (content < NOTICE_PREFIX.length + NOTICE_ARROW.length || inline.length <= content) {
        return inline;
    }

    return [
        ...wrapNoticeLine(NOTICE_PREFIX, original, content),
        ...wrapNoticeLine(NOTICE_ARROW, rewritten, content),
    ].join("\n");
}

async function rewriteCommand(
    pi: ExtensionAPI,
    command: string,
    signal?: AbortSignal,
): Promise<string | null> {
    const result = await pi.exec(RTK_COMMAND, ["rewrite", command], {
        timeout: REWRITE_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
    });

    if (result.killed) return null;
    if (result.code !== 0 && result.code !== 3) return null;
    const rewritten = result.stdout.trim();
    if (!rewritten || shouldSkipRtkRewrite(command, rewritten)) return null;
    return correctRtkRewrite(command, rewritten);
}

export default function registerRtk(pi: ExtensionAPI): void {
    const localBash = createLocalBashOperations();
    let rtkAvailable = true;
    let missingWarningShown = false;

    async function refreshRtkAvailability(): Promise<boolean> {
        const result = await pi.exec(RTK_COMMAND, ["--version"], { timeout: REWRITE_TIMEOUT_MS });
        rtkAvailable = result.code === 0;
        if (rtkAvailable) missingWarningShown = false;
        return rtkAvailable;
    }

    pi.on("session_start", async (_event, ctx) => {
        try {
            const available = await refreshRtkAvailability();
            if (!available && !missingWarningShown) {
                missingWarningShown = true;
                const message = `[rtk] ${RTK_COMMAND} binary not found — command rewrite disabled`;
                if (ctx.hasUI) ctx.ui.notify(message, "warning");
                else console.warn(message);
            }
        } catch (err) {
            rtkAvailable = false;
            if (!missingWarningShown) {
                missingWarningShown = true;
                const message = `[rtk] failed to check ${RTK_COMMAND} — command rewrite disabled`;
                if (ctx.hasUI) ctx.ui.notify(message, "warning");
                else console.warn(message, err);
            }
        }
    });

    pi.on("user_bash", async (event, ctx) => {
        if (event.excludeFromContext) return undefined;
        if (process.env.RTK_DISABLED === "1") return undefined;
        if (!rtkAvailable) return undefined;

        return {
            operations: {
                exec: async (command, cwd, options) => {
                    let commandToRun = command;

                    if (
                        typeof command === "string" &&
                        command.trim() !== "" &&
                        !command.startsWith("rtk ")
                    ) {
                        const rewritten = await rewriteCommand(pi, command, options.signal);
                        if (rewritten && rewritten !== command) {
                            commandToRun = rewritten;
                            if (ctx.hasUI)
                                ctx.ui.notify(formatRewriteNotice(command, rewritten), "info");
                        }
                    }

                    return localBash.exec(commandToRun, cwd, {
                        ...options,
                        onData: createRtkNoHookWarningDataFilter(options.onData),
                    });
                },
            },
        };
    });

    pi.on("tool_result", async (event) => {
        if (event.toolName !== "bash") return undefined;

        const content = event.content.map((item) =>
            item.type === "text" ? { ...item, text: stripRtkNoHookWarning(item.text) } : item,
        );
        return { content };
    });

    pi.on("tool_call", async (event, ctx) => {
        try {
            if (event.toolName !== "bash") return undefined;

            const command = event.input.command;
            if (typeof command !== "string" || command.trim() === "") return undefined;
            if (command.startsWith("rtk ")) return undefined;
            if (process.env.RTK_DISABLED === "1") return undefined;
            if (!rtkAvailable) return undefined;

            const rewritten = await rewriteCommand(pi, command, ctx.signal);
            if (!rewritten || rewritten === command) return undefined;

            event.input.command = rewritten;
            if (ctx.hasUI) ctx.ui.notify(formatRewriteNotice(command, rewritten), "info");
            return undefined;
        } catch (err) {
            console.warn(
                "[rtk] unexpected error in tool_call handler; passing through command",
                err,
            );
            return undefined;
        }
    });
}
