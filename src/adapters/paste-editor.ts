/**
 * Paste-collapsing editor.
 *
 * Extends the stock CustomEditor so large pastes land in the input as a compact
 * placeholder instead of flooding the prompt:
 *
 *   [Pasted text #1 +42 lines]
 *
 * Behaviour:
 *   - Pasted text is trimmed of leading/trailing whitespace (including blank
 *     lines at either end) before anything else happens.
 *   - A paste of 3+ lines (or over 1000 characters) collapses to a placeholder;
 *     smaller pastes insert literally.
 *   - The placeholder is atomic: cursor motion jumps over it and backspace
 *     removes it whole.
 *   - The external editor (Ctrl+G) receives the expanded text; when it returns,
 *     any paste whose content came back unchanged is re-collapsed to its
 *     placeholder, while edited pastes stay expanded.
 *
 * On submission, the base editor expands only its own paste markers. This editor
 * wraps the submission callback so the model receives our full pasted content.
 *
 * The bracketed-paste interception is self-contained, but the atomic-segment
 * behaviour shadows the base editor's private `segment` method. That override is
 * feature-detected: if a future pi-tui renames it, placeholders still work and
 * backspace falls back to an explicit whole-marker delete.
 */

import { CustomEditor } from "@earendil-works/pi-coding-agent";

const MARKER_PATTERN = /\[Pasted text #(\d+)(?: \+(\d+) lines| (\d+) chars)\]/g;
const COLLAPSE_MIN_LINES = 3;
const COLLAPSE_MIN_CHARS = 1000;
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const BACKSPACE_CHARS = new Set(["\x7f", "\b"]);

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Strip blank lines and stray whitespace from both ends of a paste. */
export function trimPaste(text: string): string {
    return text
        .replace(/^[\t ]*(?:\r?\n[\t ]*)+/, "")
        .replace(/(?:[\t ]*\r?\n)+[\t ]*$/, "")
        .trim();
}

export function buildMarker(id: number, content: string): string {
    const lines = content.split("\n").length;
    if (lines >= COLLAPSE_MIN_LINES) return `[Pasted text #${id} +${lines} lines]`;
    return `[Pasted text #${id} ${content.length} chars]`;
}

export function shouldCollapse(content: string): boolean {
    return content.split("\n").length >= COLLAPSE_MIN_LINES || content.length > COLLAPSE_MIN_CHARS;
}

/** All `[Pasted text #N ...]` markers present in `text`, with their ids. */
export function findMarkers(text: string): { marker: string; id: number; index: number }[] {
    const found: { marker: string; id: number; index: number }[] = [];
    for (const match of text.matchAll(MARKER_PATTERN)) {
        found.push({ marker: match[0], id: Number(match[1]), index: match.index });
    }
    return found;
}

/**
 * Segment `text` like Intl.Segmenter, but merge every known paste marker into a
 * single segment so cursor movement and deletion treat it as one unit. Mirrors
 * pi-tui's own marker-aware segmentation contract.
 */
export function segmentWithPasteMarkers(
    text: string,
    segmenter: Intl.Segmenter,
    validIds: ReadonlySet<number>,
): Intl.SegmentData[] {
    if (validIds.size === 0 || !text.includes("[Pasted text #")) {
        return Array.from(segmenter.segment(text));
    }

    const segments: Intl.SegmentData[] = [];
    let cursor = 0;
    for (const { marker, id, index } of findMarkers(text)) {
        if (!validIds.has(id) || index < cursor) continue;
        for (const segment of segmenter.segment(text.slice(cursor, index))) {
            segments.push({
                segment: segment.segment,
                index: cursor + segment.index,
                input: text,
                ...(segment.isWordLike === undefined ? {} : { isWordLike: segment.isWordLike }),
            });
        }
        segments.push({ segment: marker, index, input: text, isWordLike: true });
        cursor = index + marker.length;
    }
    for (const segment of segmenter.segment(text.slice(cursor))) {
        segments.push({
            segment: segment.segment,
            index: cursor + segment.index,
            input: text,
            ...(segment.isWordLike === undefined ? {} : { isWordLike: segment.isWordLike }),
        });
    }
    return segments;
}

/**
 * Re-collapse pastes whose exact content still appears in `text` (used when the
 * external editor hands the buffer back). Returns the collapsed text plus the
 * ids that survived.
 */
export function collapseUneditedPastes(
    text: string,
    pastes: ReadonlyMap<number, string>,
): { text: string; keptIds: Set<number> } {
    let result = text;
    const keptIds = new Set<number>();
    for (const [id, content] of pastes) {
        if (!content || !result.includes(content)) continue;
        result = result.replace(content, buildMarker(id, content));
        keptIds.add(id);
    }
    return { text: result, keptIds };
}

export class PasteEditor extends CustomEditor {
    private pastedBlocks = new Map<number, string>();
    private pasteIdCounter = 0;
    private collectingPaste = false;
    private pasteChunks = "";
    /** True when the base editor's private `segment` hook could be shadowed. */
    private segmentShadowed = false;

    constructor(...args: ConstructorParameters<typeof CustomEditor>) {
        super(...args);
        this.installSegmentShadow();
    }

    /**
     * Shadow the base editor's segmentation so our markers become atomic units
     * for cursor movement, word wrap, and deletion. Feature-detected against
     * the private API; on mismatch we quietly fall back.
     */
    private installSegmentShadow(): void {
        const self = this as unknown as Record<string, unknown>;
        if (typeof self.segment !== "function") return;
        self.segment = (text: string, mode: "word" | "grapheme") =>
            segmentWithPasteMarkers(
                text,
                mode === "word" ? wordSegmenter : graphemeSegmenter,
                new Set(this.pastedBlocks.keys()),
            );
        this.segmentShadowed = true;
    }

    /** True while a bracketed paste is being buffered (subclasses must not filter input then). */
    protected isCollectingPaste(): boolean {
        return this.collectingPaste;
    }

    private handleCollapsingPaste(pasted: string): void {
        const content = trimPaste(this.cleanPastedText(pasted));
        if (!content) return;

        if (!shouldCollapse(content)) {
            this.insertTextAtCursor(this.padForPath(content));
            return;
        }

        this.pasteIdCounter++;
        this.pastedBlocks.set(this.pasteIdCounter, content);
        this.insertTextAtCursor(buildMarker(this.pasteIdCounter, content));
    }

    /** Normalise line endings, expand tabs, and drop non-printable characters. */
    private cleanPastedText(pasted: string): string {
        // Some terminals re-encode control bytes inside bracketed paste as
        // CSI-u sequences (ESC [ code ; 5 u); decode them back first.
        // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the raw ESC byte is the point
        const decoded = pasted.replace(/\x1b\[(\d+);5u/g, (match, code: string) => {
            const codePoint = Number(code);
            if (codePoint >= 97 && codePoint <= 122) return String.fromCharCode(codePoint - 96);
            if (codePoint >= 65 && codePoint <= 90) return String.fromCharCode(codePoint - 64);
            return match;
        });
        return decoded
            .replace(/\r\n|\r/g, "\n")
            .replace(/\t/g, "    ")
            .split("")
            .filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
            .join("");
    }

    /** Prefix a pasted path with a space when it would glue onto a word. */
    private padForPath(content: string): string {
        if (!/^[/~.]/.test(content)) return content;
        const { line, col } = this.currentLineAndCol();
        const charBefore = col > 0 ? line[col - 1] : "";
        return charBefore && /\w/.test(charBefore) ? ` ${content}` : content;
    }

    private currentLineAndCol(): { line: string; col: number } {
        const cursor = this.getCursor();
        return { line: this.getLines()[cursor.line] ?? "", col: cursor.col };
    }

    /** Delete the whole marker sitting immediately before the cursor, if any. */
    private deleteMarkerBeforeCursor(): boolean {
        const { line, col } = this.currentLineAndCol();
        const before = line.slice(0, col);
        for (const { marker, id, index } of findMarkers(before)) {
            if (!this.pastedBlocks.has(id) || index + marker.length !== before.length) continue;
            for (let i = 0; i < marker.length; i++) super.handleInput("\x7f");
            return true;
        }
        return false;
    }

    override handleInput(data: string): void {
        let chunk = data;
        if (chunk.includes(PASTE_START)) {
            this.collectingPaste = true;
            this.pasteChunks = "";
            chunk = chunk.replace(PASTE_START, "");
        }
        if (this.collectingPaste) {
            this.pasteChunks += chunk;
            const endIndex = this.pasteChunks.indexOf(PASTE_END);
            if (endIndex === -1) return;
            const pasted = this.pasteChunks.slice(0, endIndex);
            const remaining = this.pasteChunks.slice(endIndex + PASTE_END.length);
            this.collectingPaste = false;
            this.pasteChunks = "";
            if (pasted.length > 0) this.handleCollapsingPaste(pasted);
            if (remaining.length > 0) this.handleInput(remaining);
            return;
        }

        // Without the segmentation shadow the base editor sees markers as plain
        // text, so make backspace delete a whole placeholder explicitly.
        if (!this.segmentShadowed && BACKSPACE_CHARS.has(chunk) && this.deleteMarkerBeforeCursor())
            return;

        this.handleBaseInput(chunk);
    }

    private expandOwnMarkers(text: string): string {
        return text.replace(MARKER_PATTERN, (marker, id: string) => {
            return this.pastedBlocks.get(Number(id)) ?? marker;
        });
    }

    override getExpandedText(): string {
        return this.expandOwnMarkers(super.getExpandedText());
    }

    /** Expand our markers before the base editor passes submitted text to pi. */
    private handleBaseInput(data: string): void {
        const onSubmit = this.onSubmit;
        if (!onSubmit || this.pastedBlocks.size === 0) {
            super.handleInput(data);
            return;
        }

        this.onSubmit = (text) => {
            const expanded = this.expandOwnMarkers(text);
            this.pastedBlocks.clear();
            this.pasteIdCounter = 0;
            onSubmit(expanded);
        };
        try {
            super.handleInput(data);
        } finally {
            this.onSubmit = onSubmit;
        }
    }

    override setText(text: string): void {
        const { text: collapsed, keptIds } = collapseUneditedPastes(text, this.pastedBlocks);
        for (const id of [...this.pastedBlocks.keys()]) {
            if (!keptIds.has(id) && !text.includes(`[Pasted text #${id}`)) {
                this.pastedBlocks.delete(id);
            }
        }
        super.setText(collapsed);
    }
}
