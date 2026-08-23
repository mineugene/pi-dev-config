/**
 * Pull-request command classification.
 *
 * Creating or editing a pull request is a server-side POST that is hard to undo,
 * so pi-dev-config only allows it through the explicit /skill:to-pr flow.
 * `commandMutatesPr` classifies one parsed command's argv, so PR words that are
 * only arguments to another command (for example `echo "gh pr create"`) pass.
 * `isGuardedPrCommand` is the raw-text fallback used when parsing fails.
 * Read-only subcommands (list, view, diff, ...) and anything outside the PR
 * namespace pass. An unknown PR verb is treated as a mutation (fail closed).
 */

const GH_PR_READS = new Set(["list", "view", "status", "checks", "diff", "checkout"]);
const AZ_PR_READS = new Set(["list", "show", "checkout"]);
const TEA_PR_READS = new Set(["list", "checkout", "clean"]);
const TEA_PR_NAMESPACES = new Set(["pull", "pulls", "pr"]);

/** Filename without directories, so `/usr/bin/gh` still classifies. */
function baseName(token: string | undefined): string | undefined {
    return token?.split("/").pop();
}

/** First token at or after `start` that is not a flag, or null. */
function verbAfter(tokens: readonly string[], start: number): string | null {
    for (let i = start; i < tokens.length; i++) {
        const token = tokens[i];
        if (token && !token.startsWith("-")) return token;
    }
    return null;
}

/**
 * True when one parsed command's argv is a mutating gh / az / tea pull-request
 * command. Only the command at argv[0] is classified.
 */
export function commandMutatesPr(argv: readonly string[]): boolean {
    const name = baseName(argv[0]);
    const first = argv[1];
    const second = argv[2];

    if (name === "gh" && first === "pr") {
        const verb = verbAfter(argv, 2);
        return verb !== null && !GH_PR_READS.has(verb);
    }
    if (name === "az" && first === "repos" && second === "pr") {
        const verb = verbAfter(argv, 3);
        return verb !== null && !AZ_PR_READS.has(verb);
    }
    if (name === "tea" && first !== undefined && TEA_PR_NAMESPACES.has(first)) {
        const verb = verbAfter(argv, 2);
        return verb !== null && !TEA_PR_READS.has(verb);
    }
    return false;
}

/** Index where the contiguous `seq` begins in `tokens`, or -1. */
function findSequence(tokens: string[], seq: string[]): number {
    outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
        for (let j = 0; j < seq.length; j++) {
            if (tokens[i + j] !== seq[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function segmentMutatesPr(tokens: string[]): boolean {
    const gh = findSequence(tokens, ["gh", "pr"]);
    if (gh !== -1) {
        const verb = verbAfter(tokens, gh + 2);
        if (verb && !GH_PR_READS.has(verb)) return true;
    }
    const az = findSequence(tokens, ["az", "repos", "pr"]);
    if (az !== -1) {
        const verb = verbAfter(tokens, az + 3);
        if (verb && !AZ_PR_READS.has(verb)) return true;
    }
    for (const namespace of TEA_PR_NAMESPACES) {
        const tea = findSequence(tokens, ["tea", namespace]);
        if (tea !== -1) {
            const verb = verbAfter(tokens, tea + 2);
            if (verb && !TEA_PR_READS.has(verb)) return true;
        }
    }
    return false;
}

/**
 * Raw-text fallback for commands the parser cannot read. It over-matches PR
 * words in arguments, so callers MUST prefer `commandMutatesPr` on parsed argv
 * and use this only when parsing failed.
 */
export function isGuardedPrCommand(command: string): boolean {
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
        const tokens = segment.trim().split(/\s+/).filter(Boolean);
        if (segmentMutatesPr(tokens)) return true;
    }
    return false;
}
