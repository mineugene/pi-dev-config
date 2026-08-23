export interface ShellToolAvailability {
    readonly rg: boolean;
    readonly fd: boolean;
}

function pair(first: string, second: string | undefined): string {
    return second === undefined ? first : `${first} and ${second}`;
}

/** Guideline pointing Bash at installed modern tools, or undefined when neither is present. */
export function formatShellPreference(available: ShellToolAvailability): string | undefined {
    const preferences = [
        available.rg ? "`rg` instead of `grep`" : undefined,
        available.fd ? "`fd` instead of `find`" : undefined,
    ].filter((entry): entry is string => entry !== undefined);
    if (preferences.length === 0) return undefined;
    return `In Bash, use ${pair(preferences[0] ?? "", preferences[1])}; fall back to the GNU tool only when the preferred command is unavailable.`;
}

/** Swap the GNU tools named in a Bash snippet for the installed replacements. */
export function rewriteBashSnippet(snippet: string, available: ShellToolAvailability): string {
    let rewritten = snippet;
    if (available.rg) rewritten = rewritten.replace(/\bgrep\b/g, "rg");
    if (available.fd) rewritten = rewritten.replace(/\bfind\b/g, "fd");
    return rewritten;
}
