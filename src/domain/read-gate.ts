/**
 * Read gate.
 *
 * A naive whole-file read of a large file (log, CSV, data dump) forces the model
 * to paginate through it, which is far more expensive than grepping for the
 * region of interest first. `describeReadGate` is the pure decision: it fires
 * only for an unbounded read (no offset and no limit) of a file over the byte
 * threshold. A windowed read, or a file under the gate, passes through.
 */

import { formatBytes } from "./format.ts";

export interface ReadGateParams {
    path: string;
    offset?: number;
    limit?: number;
}

/**
 * Message to hand back in place of a large unbounded read, or null to let the
 * read proceed. Windowed reads (offset/limit set) always pass, so the model can
 * still page deliberately after a grep, or force the read outright.
 */
export function describeReadGate(
    params: ReadGateParams,
    sizeBytes: number,
    thresholdBytes: number,
): string | null {
    const windowed = params.offset !== undefined || params.limit !== undefined;
    if (thresholdBytes <= 0 || windowed || sizeBytes <= thresholdBytes) return null;
    return (
        `read skipped: ${params.path} is ${formatBytes(sizeBytes)}, over the ${formatBytes(thresholdBytes)} gate. ` +
        "Large or unstructured files (logs, CSVs, data dumps) are cheaper to grep than to page through. " +
        "Search for the region of interest, then read a focused window with offset/limit. " +
        "To read it anyway, call read again with an explicit offset and/or limit."
    );
}

/**
 * True when `path` ends with one of `extensions`. Each extension is matched
 * case-insensitively with an optional leading `*` and/or `.` ("pdf", ".pdf",
 * and "*.pdf" are equivalent); blank entries are ignored.
 */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"] as const;

/** Images and configured binary-like extensions are not useful grep targets. */
export function shouldBypassReadGate(path: string, configured: readonly string[]): boolean {
    return hasExtension(path, IMAGE_EXTENSIONS) || hasExtension(path, configured);
}

export function hasExtension(path: string, extensions: readonly string[]): boolean {
    const lower = path.toLowerCase();
    return extensions.some((ext) => {
        const normalized = ext
            .trim()
            .toLowerCase()
            .replace(/^\*?\.?/, "");
        return normalized.length > 0 && lower.endsWith(`.${normalized}`);
    });
}
