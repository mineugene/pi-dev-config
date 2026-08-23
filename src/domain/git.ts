/**
 * Git command classification.
 *
 * A git command that creates or rewrites a commit (or signs a tag) triggers the
 * signing key, which on a touch-required YubiKey blocks until a physical touch.
 * `isSigningCommand` spots those so the harness can warn first. It is a heuristic
 * over the command string, not a git parser: it splits on shell separators and
 * reads the `git` subcommand, so quoting edge cases may over- or under-match.
 * Over-matching only costs an extra heads-up, so it errs that way.
 */

/** git subcommands that create or rewrite a commit, so they sign when signing is on. */
const SIGNING_SUBCOMMANDS = new Set(["commit", "merge", "rebase", "cherry-pick", "revert"]);
const NO_SIGN_FLAG = /(?:^|\s)--no-(?:gpg-)?sign(?:\s|$)/;
const TAG_SIGN_FLAG = /(?:^|\s)(?:-s|--sign)(?:\s|$)/;

/** The git subcommand of one command segment, skipping global flags (`-C dir`, `-c k=v`). */
function gitSubcommand(segment: string): string | null {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const gitIndex = tokens.indexOf("git");
    if (gitIndex === -1) return null;
    let i = gitIndex + 1;
    while (i < tokens.length) {
        const token = tokens[i];
        if (token === undefined || !token.startsWith("-")) break;
        // -C <path> and -c <name=value> consume a following value token.
        if (token === "-C" || token === "-c") i++;
        i++;
    }
    return tokens[i] ?? null;
}

/**
 * True when the command would create or rewrite a commit, or sign a tag, so a
 * signing key (and a YubiKey touch) is likely involved. Segments split on `&&`,
 * `||`, `;`, `|`, and newlines are checked independently; a `--no-gpg-sign` /
 * `--no-sign` opt-out clears the match.
 */
export function isSigningCommand(command: string): boolean {
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
        const sub = gitSubcommand(segment);
        if (!sub) continue;
        if (SIGNING_SUBCOMMANDS.has(sub)) {
            if (NO_SIGN_FLAG.test(segment)) continue;
            return true;
        }
        if (sub === "tag" && TAG_SIGN_FLAG.test(segment)) return true;
    }
    return false;
}

/** `git commit` message args: `-m subject`, plus `-m body` when a non-empty body is given. */
export function commitMessageArgs(subject: string, body?: string): string[] {
    const args = ["-m", subject];
    const trimmedBody = body?.trim();
    if (trimmedBody) args.push("-m", trimmedBody);
    return args;
}
