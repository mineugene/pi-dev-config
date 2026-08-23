/**
 * fff-backed `@` file mentions.
 *
 * Replaces pi's built-in `@` autocomplete with a fff-powered fuzzy search over
 * the whole workspace (files and directories) ranked by frecency. Insertion and
 * every non-`@` completion are delegated to the built-in provider.
 *
 * Two extras over the built-in:
 *   - Spaces in a path are kept in one token by quoting: `@"dir with space/file"`.
 *   - Paths outside the workspace work too. When the query is absolute, `~`-based,
 *     or reaches up with `../`, a bounded auxiliary index is built for that root
 *     and matches are inserted as absolute `@"/…"` references.
 */

import { homedir } from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { MixedItem } from "@ff-labs/fff-node";

import { canUseFffRoot, fff } from "../infra/fff.ts";

const MAX_RESULTS = 20;

/**
 * Pull the active `@token` sitting just before the cursor, if any. Accepts an
 * open-quoted form (`@"foo ba`) so a query can contain spaces mid-typing.
 */
export function extractAtPrefix(textBeforeCursor: string): string | null {
    const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
    return match?.[1] ?? null;
}

/** An unquoted mention ends at whitespace; do not offer ordinary path completion after it. */
export function endsAfterUnquotedMention(textBeforeCursor: string): boolean {
    return /(?:^|[ \t])@[^\s"]*[ \t]+$/.test(textBeforeCursor);
}

/** Quote paths that contain spaces so the mention stays a single token. */
function buildCompletionValue(mentionPath: string): string {
    return mentionPath.includes(" ") ? `@"${mentionPath}"` : `@${mentionPath}`;
}

/**
 * When the query points outside the workspace, resolve the external root to
 * index and the fuzzy fragment to search within it. Returns null for ordinary
 * in-workspace queries, which are searched against the cwd index instead.
 */
function resolveExternal(query: string, cwd: string): { root: string; fragment: string } | null {
    let expanded = query;
    if (expanded === "~" || expanded.startsWith("~/")) expanded = homedir() + expanded.slice(1);

    const isPathLike =
        path.isAbsolute(expanded) || query.startsWith("../") || query.startsWith("..");
    if (!isPathLike) return null;

    const absolute = path.resolve(cwd, expanded);
    if (query.endsWith("/") || expanded.endsWith("/")) return { root: absolute, fragment: "" };
    return { root: path.dirname(absolute), fragment: path.basename(absolute) };
}

export default function registerFileMention(pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, ctx) => {
        const cwd = ctx.cwd;

        ctx.ui.addAutocompleteProvider((current) => ({
            async getSuggestions(lines, cursorLine, cursorCol, options) {
                const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
                const atPrefix = extractAtPrefix(before);

                // Whitespace terminates an unquoted mention. Without this guard the
                // built-in provider treats the trailing space as a fresh path prefix.
                if (!atPrefix && !options.force && endsAfterUnquotedMention(before)) return null;

                // Not an `@` token: hand back to the built-in slash/path provider.
                if (!atPrefix) return current.getSuggestions(lines, cursorLine, cursorCol, options);
                if (options.signal.aborted) return null;

                const query = atPrefix.startsWith('@"') ? atPrefix.slice(2) : atPrefix.slice(1);
                const external = resolveExternal(query, cwd);
                const root = external ? external.root : cwd;
                const searchTerm = external ? external.fragment : query;

                // fff intentionally refuses home and filesystem roots. The built-in
                // provider handles these broad prefixes while the user types deeper.
                if (!canUseFffRoot(root)) {
                    return current.getSuggestions(lines, cursorLine, cursorCol, options);
                }

                try {
                    const finder = await fff.ensure(root, {
                        primary: !external,
                        refresh: true,
                    });
                    options.signal.throwIfAborted();

                    const search = finder.mixedSearch(searchTerm, { pageSize: MAX_RESULTS });
                    if (!search.ok) {
                        // Autocomplete failures are expected when fff cannot initialise
                        // a particular external root. Fall back silently: console output
                        // corrupts the active prompt and footer in the TUI.
                        return current.getSuggestions(lines, cursorLine, cursorCol, options);
                    }

                    const items: AutocompleteItem[] = search.value.items
                        .slice(0, MAX_RESULTS)
                        .map((mixed: MixedItem) => {
                            const relativePath = mixed.item.relativePath;
                            const label =
                                mixed.type === "directory"
                                    ? mixed.item.dirName
                                    : mixed.item.fileName;
                            // External matches are absolute so they resolve regardless of cwd.
                            const mentionPath = external
                                ? path.join(root, relativePath)
                                : relativePath;
                            return {
                                value: buildCompletionValue(mentionPath),
                                label,
                                description: mentionPath,
                            };
                        });

                    if (items.length === 0) return null;
                    return { prefix: atPrefix, items };
                } catch {
                    if (options.signal.aborted) return null;
                    // See the failed-search case above. The built-in provider is the
                    // resilient path for roots fff cannot index.
                    return current.getSuggestions(lines, cursorLine, cursorCol, options);
                }
            },

            applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
                return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
            },

            shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
                return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
            },
        }));
    });
}
