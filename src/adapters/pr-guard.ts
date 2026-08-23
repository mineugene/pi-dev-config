/**
 * PR guard.
 *
 * Creating or editing a pull request is a server-side POST that is hard to roll
 * back, so this blocks any mutating gh / az / tea PR command from the bash tool
 * unless the turn was started with the `/skill:to-pr` skill. It recognises
 * that turn by a sentinel carried in the expanded skill message.
 * Read-only PR commands (list, view, diff, ...) and everything else pass through.
 *
 * Classification runs on parsed commands, so a PR command name that appears only
 * as an argument (`echo "gh pr create"`, `rg "gh pr create"`) does not trip it.
 * Shells (`sh -c`), command wrappers (`sudo`, `env`, ...), and `find -exec`
 * segments are followed, up to a small depth.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { commandMutatesPr, isGuardedPrCommand } from "../domain/pr.ts";
import { extractBashFacts } from "../infra/bash-parser.ts";

/** Marker the to-pr skill embeds so this guard can recognise its turns. */
const PR_SENTINEL = "pidev:to-pr-skill";

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "nice", "time", "stdbuf", "xargs"]);
const EXEC_COMMANDS = new Set(["find", "fd"]);
const EXEC_FLAGS = new Set(["-exec", "-execdir"]);
const EXEC_TERMINATORS = new Set([";", "\\;", "+"]);
const MAX_DEPTH = 3;

/** Filename without directories, so `/usr/bin/gh` still classifies. */
function baseName(token: string | undefined): string | undefined {
    return token?.split("/").pop();
}

/** The script argument of a `-c` flag, including short clusters like `-lc`. */
function shellScriptArg(argv: readonly string[]): string | undefined {
    for (let i = 1; i < argv.length; i++) {
        const token = argv[i];
        if (token !== undefined && (token === "-c" || /^-[a-z]*c[a-z]*$/u.test(token))) {
            return argv[i + 1];
        }
    }
    return undefined;
}

/** True when this argv executes a mutating PR command, following wrappers. */
async function argvMutatesPr(argv: readonly string[], depth: number): Promise<boolean> {
    if (commandMutatesPr(argv)) return true;
    if (depth >= MAX_DEPTH) return false;

    const name = baseName(argv[0]);
    if (name === undefined) return false;

    if (SHELLS.has(name)) {
        const script = shellScriptArg(argv);
        if (script !== undefined && (await mutatesPr(script, depth + 1))) return true;
    }

    if (WRAPPERS.has(name)) {
        // A wrapper executes the rest of its argv, so check every suffix.
        for (let i = 1; i < argv.length; i++) {
            if (commandMutatesPr(argv.slice(i))) return true;
        }
    }

    if (EXEC_COMMANDS.has(name)) {
        for (let i = 1; i < argv.length; i++) {
            const token = argv[i];
            if (token === undefined || !EXEC_FLAGS.has(token)) continue;

            const end = argv.findIndex(
                (arg, index) => index > i && EXEC_TERMINATORS.has(arg as string),
            );
            const segment = argv.slice(i + 1, end === -1 ? undefined : end);
            if (segment.length > 0 && (await argvMutatesPr(segment, depth + 1))) return true;
        }
    }

    return false;
}

/** True when the command executes a mutating PR command at any depth. */
async function mutatesPr(command: string, depth: number): Promise<boolean> {
    const facts = await extractBashFacts(command);
    if (facts.hasParseError) return isGuardedPrCommand(command);

    for (const parsed of facts.commands) {
        if (await argvMutatesPr(parsed.argv, depth)) return true;
    }
    return false;
}

export default function registerPrGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "bash") return undefined;
        const command = typeof event.input?.command === "string" ? event.input.command : "";

        // Cheap pre-filter: no PR verb in the text means no parse is needed.
        if (!/pr|pull/u.test(command)) return undefined;
        if (!(await mutatesPr(command, 0))) return undefined;

        // Allow only when this turn came from to-pr: scan back to the most
        // recent user message and look for the skill's sentinel.
        const entries = ctx.sessionManager.getEntries();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry?.type !== "message" || entry.message.role !== "user") continue;
            if (JSON.stringify(entry.message).includes(PR_SENTINEL)) return undefined;
            break;
        }

        return {
            block: true,
            reason: "Creating or editing a pull request is only allowed via /skill:to-pr; reads (list, view, diff) are fine. Ask me to run /skill:to-pr.",
        };
    });
}
