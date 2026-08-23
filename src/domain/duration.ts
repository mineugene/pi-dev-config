/** Format milliseconds with compact, human-friendly units. */
export function formatDuration(ms: number): string {
    const elapsedMs = Math.max(0, Number.isFinite(ms) ? Math.floor(ms) : 0);
    if (elapsedMs < 1_000) return `${elapsedMs}ms`;

    const totalSeconds = Math.floor(elapsedMs / 1_000);
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}
