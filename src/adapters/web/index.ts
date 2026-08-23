import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { readWebPage, searchBrave, type WebSearchResult } from "../../infra/web.ts";
import type { ConfigRef } from "../feature.ts";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;
const DEFAULT_MAX_TOKENS = 6_000;
const MIN_MAX_TOKENS = 500;
const MAX_MAX_TOKENS = 12_000;

const searchSchema = Type.Object({
    query: Type.String({ minLength: 1, description: "Public-web search query." }),
    limit: Type.Optional(
        Type.Integer({
            minimum: 1,
            maximum: MAX_SEARCH_LIMIT,
            description: "Result count. Default 5; maximum 10.",
        }),
    ),
});
const readSchema = Type.Object({
    url: Type.String({ minLength: 1, description: "HTTP(S) page URL to read." }),
    query: Type.Optional(Type.String({ description: "Topic to prioritise within the page." })),
    maxTokens: Type.Optional(
        Type.Integer({
            minimum: MIN_MAX_TOKENS,
            maximum: MAX_MAX_TOKENS,
            description: "Hard output-token budget. Default 6000; maximum 12000.",
        }),
    ),
});
type SearchInput = Static<typeof searchSchema>;
type ReadInput = Static<typeof readSchema>;

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}

function formatSearch(results: WebSearchResult[]): string {
    if (!results.length) return "No web results found.";
    return results
        .map((result, index) => {
            const metadata = [result.published, result.source ?? new URL(result.url).hostname]
                .filter(Boolean)
                .join(" · ");
            return `${index + 1}. ${result.title}\n   ${result.url}\n   ${metadata}${result.snippet ? `\n   ${result.snippet}` : ""}`;
        })
        .join("\n\n");
}

export default function registerWeb(pi: ExtensionAPI, configRef: ConfigRef): void {
    pi.registerTool({
        name: "web_search",
        label: "web_search",
        description:
            "Search the public web and return compact result metadata. Use this to choose promising sources before web_read; it does not fetch result pages.",
        parameters: searchSchema,
        async execute(_id, params: SearchInput, signal) {
            const limit = bounded(
                params.limit ?? configRef.current.web?.search?.limit,
                DEFAULT_SEARCH_LIMIT,
                1,
                MAX_SEARCH_LIMIT,
            );
            const results = await searchBrave(params.query, limit, signal);
            return {
                content: [{ type: "text" as const, text: formatSearch(results) }],
                details: {},
            };
        },
    });
    pi.registerTool({
        name: "web_read",
        label: "web_read",
        description:
            "Fetch one web page as clean, token-bounded Markdown. Give query for a focused section; prefer focused reads over loading huge pages.",
        parameters: readSchema,
        async execute(_id, params: ReadInput, signal) {
            const config = configRef.current.web?.read;
            const result = await readWebPage(
                params.url,
                {
                    ...(params.query ? { query: params.query } : {}),
                    maxTokens: bounded(
                        params.maxTokens,
                        config?.maxTokens ?? DEFAULT_MAX_TOKENS,
                        MIN_MAX_TOKENS,
                        MAX_MAX_TOKENS,
                    ),
                    ...(config?.maxResponseBytes
                        ? { maxResponseBytes: config.maxResponseBytes }
                        : {}),
                    ...(config?.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
                },
                signal,
            );
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `${result.content}\n\n[truncated: ${result.truncated}; estimated tokens: ${result.estimatedTokens}]`,
                    },
                ],
                details: result,
            };
        },
    });
}
