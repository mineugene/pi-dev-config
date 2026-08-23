/** Bound model-facing text while keeping an explicit truncation marker. */
export function truncateHead(text: string, maxChars: number, marker: string): string {
    if (text.length <= maxChars) return text;
    if (maxChars <= 0) return "";
    if (marker.length >= maxChars) return marker.slice(0, maxChars);
    return text.slice(0, maxChars - marker.length) + marker;
}

/** Bound model-facing text while preserving its most recent content. */
export function truncateTail(text: string, maxChars: number, marker: string): string {
    if (text.length <= maxChars) return text;
    if (maxChars <= 0) return "";
    if (marker.length >= maxChars) return marker.slice(0, maxChars);
    return marker + text.slice(text.length - (maxChars - marker.length));
}
