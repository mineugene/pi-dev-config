/**
 * fff-backed `grep` and `find` tools.
 *
 * Registers `grep` (content) and `find` (path) with the same names as pi's
 * built-ins, so they take over "grep mode": both are frecency-ranked, git-aware,
 * and typo-resistant, sharing the workspace index built in fff.ts. `grep`
 * auto-detects regex vs literal and falls back to a fuzzy pass when an exact
 * search finds nothing.
 */

import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GrepMatch, GrepMode, GrepResult, SearchResult } from "@ff-labs/fff-node";
import { type Static, Type } from "typebox";
import { buildQuery } from "../domain/query.ts";
import { truncateHead } from "../domain/text.ts";
import { fff } from "../infra/fff.ts";
import { resolveSearchScope } from "../infra/search-scope.ts";

const GREP_LIMIT = 20;
const FIND_LIMIT = 20;
const MAX_CONTEXT = 3;
const MAX_LINE = 240;
const MAX_OUTPUT_CHARS = 20_000;
const GREP_TIME_BUDGET_MS = 10_000;
const OUTPUT_TRUNCATION_MARKER =
    "\n\n[Search output truncated. Narrow the pattern/path or request less context.]";

const pathParam = Type.Optional(
    Type.String({
        description:
            "Path constraint: directory prefix ('src/'), filename ('main.rs'), or glob ('*.ts', 'src/**/*.cc'). Absolute, ~, and ../ paths may select a root outside the workspace.",
    }),
);
const excludeParam = Type.Optional(
    Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
            "Paths to exclude (comma/space-separated or array). Same syntax as path; a leading '!' is optional.",
    }),
);

const grepSchema = Type.Object({
    pattern: Type.String({
        description: "Text or regex to search for. Bare identifiers are most efficient.",
    }),
    path: pathParam,
    exclude: excludeParam,
    caseSensitive: Type.Optional(
        Type.Boolean({
            description:
                "Force case-sensitive matching. Default is smart-case (case-insensitive when the pattern is all lowercase).",
        }),
    ),
    context: Type.Optional(
        Type.Integer({
            minimum: 0,
            maximum: MAX_CONTEXT,
            description: `Context lines before and after each match (max ${MAX_CONTEXT}).`,
        }),
    ),
    limit: Type.Optional(
        Type.Integer({
            minimum: 1,
            maximum: GREP_LIMIT,
            description: `Max matches to return (default and max ${GREP_LIMIT}).`,
        }),
    ),
});

const findSchema = Type.Object({
    pattern: Type.String({
        description:
            "Fuzzy path/filename query. Matches the whole repo-relative path; extra words narrow (AND).",
    }),
    path: pathParam,
    exclude: excludeParam,
    limit: Type.Optional(
        Type.Integer({
            minimum: 1,
            maximum: FIND_LIMIT,
            description: `Max results to return (default and max ${FIND_LIMIT}).`,
        }),
    ),
});

type GrepInput = Static<typeof grepSchema>;
type FindInput = Static<typeof findSchema>;

/** True when the pattern contains regex metacharacters that also compile. */
function detectMode(pattern: string): GrepMode {
    const hasRegexSyntax = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!hasRegexSyntax) return "plain";
    try {
        new RegExp(pattern);
        return "regex";
    } catch {
        return "plain";
    }
}

function truncateLine(line: string): string {
    const clean = line.replace(/\r?\n/g, " ");
    return clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE)}…` : clean;
}

export function limitSearchOutput(text: string): string {
    return truncateHead(text, MAX_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER);
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
    return Math.min(maximum, Math.max(1, Math.trunc(value ?? fallback)));
}

function formatResultPath(relativePath: string, externalRoot?: string): string {
    return externalRoot ? path.resolve(externalRoot, relativePath) : relativePath;
}

function formatGrep(result: GrepResult, externalRoot?: string): string {
    if (result.items.length === 0) {
        return result.nextCursor
            ? "No matches before the search time budget was reached."
            : "No matches.";
    }
    const byFile = new Map<string, GrepMatch[]>();
    for (const match of result.items) {
        const bucket = byFile.get(match.relativePath) ?? [];
        bucket.push(match);
        byFile.set(match.relativePath, bucket);
    }

    const blocks: string[] = [];
    for (const [file, matches] of byFile) {
        const lines = [formatResultPath(file, externalRoot)];
        for (const match of matches) {
            for (const [i, ctx] of (match.contextBefore ?? []).entries()) {
                lines.push(
                    `  ${match.lineNumber - (match.contextBefore?.length ?? 0) + i}  ${truncateLine(ctx)}`,
                );
            }
            lines.push(`  ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
            for (const [i, ctx] of (match.contextAfter ?? []).entries()) {
                lines.push(`  ${match.lineNumber + 1 + i}  ${truncateLine(ctx)}`);
            }
        }
        blocks.push(lines.join("\n"));
    }
    if (result.nextCursor) {
        blocks.unshift("[More matches may exist; result limit or time budget reached.]");
    }
    return blocks.join("\n\n");
}

function formatFind(result: SearchResult, externalRoot?: string): string {
    if (result.items.length === 0) return "No files matched.";
    return result.items.map((item) => formatResultPath(item.relativePath, externalRoot)).join("\n");
}

async function runGrep(
    params: GrepInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
): Promise<string> {
    const scope = resolveSearchScope(params.path, ctx.cwd);
    const finder = await fff.ensure(scope.root, {
        primary: scope.root === path.resolve(ctx.cwd),
        refresh: true,
    });
    signal?.throwIfAborted();
    const limit = boundedInteger(params.limit, GREP_LIMIT, GREP_LIMIT);
    const context = Math.min(MAX_CONTEXT, Math.max(0, Math.trunc(params.context ?? 0)));
    const smartCase = params.caseSensitive !== true;
    const query = buildQuery(scope.path, params.pattern, params.exclude, scope.root);
    const mode = detectMode(params.pattern);

    const options = {
        mode,
        smartCase,
        maxMatchesPerFile: Math.min(limit, 50),
        beforeContext: context,
        afterContext: context,
        pageSize: limit,
        timeBudgetMs: GREP_TIME_BUDGET_MS,
    };

    const deadline = Date.now() + GREP_TIME_BUDGET_MS;
    const primary = finder.grep(query, options);
    if (!primary.ok) throw new Error(primary.error);
    signal?.throwIfAborted();

    let result = primary.value;
    let notice = "";
    if (result.items.length === 0 && !result.nextCursor && mode !== "regex") {
        const remainingMs = Math.min(GREP_TIME_BUDGET_MS, deadline - Date.now());
        if (remainingMs > 0) {
            const fuzzy = finder.grep(query, {
                ...options,
                mode: "fuzzy",
                beforeContext: 0,
                afterContext: 0,
                timeBudgetMs: remainingMs,
            });
            signal?.throwIfAborted();
            if (fuzzy.ok && (fuzzy.value.items.length > 0 || fuzzy.value.nextCursor)) {
                result = fuzzy.value;
                notice = fuzzy.value.items.length
                    ? "[0 exact matches; showing fuzzy matches]\n"
                    : "[0 exact matches; fuzzy search reached its time budget]\n";
            }
        }
    }
    if (result.regexFallbackError)
        notice += `[invalid regex: ${result.regexFallbackError}; matched literally]\n`;

    const externalRoot = scope.root === path.resolve(ctx.cwd) ? undefined : scope.root;
    return limitSearchOutput(notice + formatGrep(result, externalRoot));
}

async function runFind(
    params: FindInput,
    ctx: ExtensionContext,
    signal?: AbortSignal,
): Promise<string> {
    const scope = resolveSearchScope(params.path, ctx.cwd);
    const finder = await fff.ensure(scope.root, {
        primary: scope.root === path.resolve(ctx.cwd),
        refresh: true,
    });
    signal?.throwIfAborted();
    const limit = boundedInteger(params.limit, FIND_LIMIT, FIND_LIMIT);
    const query = buildQuery(scope.path, params.pattern, params.exclude, scope.root);
    const result = finder.fileSearch(query, { pageSize: limit });
    if (!result.ok) throw new Error(result.error);
    const externalRoot = scope.root === path.resolve(ctx.cwd) ? undefined : scope.root;
    return limitSearchOutput(formatFind(result.value, externalRoot));
}

export default function registerSearch(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "grep",
        label: "grep",
        description:
            "Search file contents with fff: smart-case, regex detection, git-aware ranking, and fuzzy fallback.",
        promptSnippet: "Grep file contents (fff)",
        promptGuidelines: [
            "Prefer bare identifiers as the grep pattern; literal queries are fastest.",
            "Scope grep with path ('src/', '*.ts') and cut noise with exclude ('test/,*.min.js').",
            "After one or two greps, read the top match rather than grepping again.",
        ],
        parameters: grepSchema,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (signal?.aborted) throw new Error("Operation aborted");
            const text = await runGrep(params, ctx, signal);
            return { content: [{ type: "text", text }], details: {} };
        },
    });

    pi.registerTool({
        name: "find",
        label: "find",
        description:
            "Find files by fuzzy path or glob with fff; git-aware, frecency-ranked, with multi-word AND matching.",
        promptSnippet: "Find files by path (fff)",
        promptGuidelines: [
            "find matches the WHOLE path, so 'profile' also hits 'browser/profiles/x.cc'.",
            "Keep find queries to one or two terms; use path globs ('**/name.h') for exact filenames.",
            "Use find for paths and grep for contents.",
        ],
        parameters: findSchema,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (signal?.aborted) throw new Error("Operation aborted");
            const text = await runFind(params, ctx, signal);
            return { content: [{ type: "text", text }], details: {} };
        },
    });
}
