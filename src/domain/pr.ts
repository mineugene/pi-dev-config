/**
 * Pull-request command classification.
 *
 * Creating or editing a pull request is a server-side POST that is hard to undo,
 * so pi-dev-config only allows it through the explicit /pr command.
 * `isGuardedPrCommand` spots a mutating gh / az / tea pull-request command;
 * read-only subcommands (list, view, diff, ...) and anything outside the PR
 * namespace pass. An unknown PR verb is treated as a mutation (fail closed).
 */

const GH_PR_READS = new Set(["list", "view", "status", "checks", "diff", "checkout"]);
const AZ_PR_READS = new Set(["list", "show", "checkout"]);
const TEA_PR_READS = new Set(["list", "checkout", "clean"]);

/** First token at or after `start` that is not a flag, or null. */
function verbAfter(tokens: string[], start: number): string | null {
    for (let i = start; i < tokens.length; i++) {
        const token = tokens[i];
        if (token && !token.startsWith("-")) return token;
    }
    return null;
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
    for (const namespace of ["pull", "pulls", "pr"]) {
        const tea = findSequence(tokens, ["tea", namespace]);
        if (tea !== -1) {
            const verb = verbAfter(tokens, tea + 2);
            if (verb && !TEA_PR_READS.has(verb)) return true;
        }
    }
    return false;
}

/**
 * True when the command creates or edits a pull request through gh, az, or tea
 * (a PR-namespace subcommand that is not a known read). Segments split on `&&`,
 * `||`, `;`, `|`, and newlines are checked independently.
 */
export function isGuardedPrCommand(command: string): boolean {
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
        const tokens = segment.trim().split(/\s+/).filter(Boolean);
        if (segmentMutatesPr(tokens)) return true;
    }
    return false;
}
