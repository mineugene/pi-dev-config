/**
 * Pure display formatting. No I/O; cheap to unit test.
 */

/** Compact token counts: 950 -> "950", 8200 -> "8.2k", 128000 -> "128k", 2e6 -> "2.0M". */
export function formatTokens(count: number): string {
    if (!Number.isFinite(count) || count < 0) return "?";
    if (count < 1_000) return String(Math.round(count));
    if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
    if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
    if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    return `${Math.round(count / 1_000_000)}M`;
}

/** Human-readable byte sizes for gate messages: 512 -> "512B", 262144 -> "256KB", 3e6 -> "2.9MB". */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "?";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${Math.round(bytes)}B`;
}

/** Replace a leading $HOME with `~` for display. */
export function shortenHome(dir: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home && dir.startsWith(home)) return `~${dir.slice(home.length)}`;
    return dir;
}
