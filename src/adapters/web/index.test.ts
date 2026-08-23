import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import registerWeb from "./index.ts";

type Tool = {
    name: string;
    execute: (
        id: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
    ) => Promise<{ content: [{ text: string }] }>;
};

function tools(): Tool[] {
    const registered: Tool[] = [];
    registerWeb(
        { registerTool: (tool: Tool) => registered.push(tool) } as unknown as ExtensionAPI,
        {
            current: {},
        },
    );
    return registered;
}

function tool(name: string): Tool {
    const found = tools().find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing ${name}`);
    return found;
}

afterEach(() => vi.unstubAllGlobals());

describe("web tools", () => {
    it("searches Brave metadata without fetching result URLs", async () => {
        const fetch = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    web: {
                        results: [
                            {
                                title: "Result",
                                url: "https://example.com/page",
                                description: "Short snippet",
                                age: "2026-01-01",
                            },
                        ],
                    },
                }),
                { status: 200 },
            ),
        );
        vi.stubGlobal("fetch", fetch);
        vi.stubEnv("WEB_SEARCH_API_KEY", "key");

        const result = await tool("web_search").execute("call", { query: "test", limit: 99 });

        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0]?.[0]).toContain("api.search.brave.com");
        expect(fetch.mock.calls[0]?.[0]).toContain("count=10");
        expect(result.content[0].text).toContain("1. Result");
        expect(result.content[0].text).toContain("https://example.com/page");
    });

    it("reads one safe page as bounded, query-focused Markdown", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        "<title>Guide</title><article><h1>Guide</h1><h2>Install</h2><p>Install it.</p><h2>Authentication</h2><p>OAuth API keys.</p></article>",
                        { headers: { "content-type": "text/html" } },
                    ),
                ),
        );

        const result = await tool("web_read").execute("call", {
            url: "https://example.com/guide",
            query: "OAuth",
            maxTokens: 500,
        });

        expect(result.content[0].text).toContain("# Guide");
        expect(result.content[0].text).toContain("## Authentication");
        expect(result.content[0].text).toContain("[truncated:");
    });

    it("rejects unsafe URLs before fetching", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        await expect(
            tool("web_read").execute("call", { url: "http://127.0.0.1/private" }),
        ).rejects.toThrow("blocked private-network destination");
        expect(fetch).not.toHaveBeenCalled();
    });
});
