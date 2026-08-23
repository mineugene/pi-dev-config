import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FileFinderApi } from "@ff-labs/fff-node";
import { describe, expect, it, vi } from "vitest";
import { fff } from "../infra/fff.ts";
import registerSearch, { limitSearchOutput } from "./search.ts";

type SearchToolExecute = (
    toolCallId: string,
    params: { pattern: string; limit?: number; context?: number },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
) => Promise<{
    content: [{ type: "text"; text: string }, ...Array<{ type: "text"; text: string }>];
    details: Record<string, never>;
}>;
type SearchTool =
    | {
          name: "grep";
          parameters: {
              properties: {
                  context: { maximum?: number };
                  limit: { maximum?: number };
              };
          };
          execute: SearchToolExecute;
      }
    | {
          name: "find";
          parameters: { properties: { limit: { maximum?: number } } };
          execute: SearchToolExecute;
      };

function findTool<TName extends SearchTool["name"]>(
    tools: SearchTool[],
    name: TName,
): Extract<SearchTool, { name: TName }> {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Search tool was not registered: ${name}`);
    return tool as Extract<SearchTool, { name: TName }>;
}

describe("search token bounds", () => {
    it("caps model-facing output", () => {
        const output = limitSearchOutput("x".repeat(60_000));

        expect(output).toHaveLength(20_000);
        expect(output).toContain("[Search output truncated.");
    });

    it("publishes hard schema limits", () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);

        const grep = findTool(tools, "grep");
        const find = findTool(tools, "find");
        expect(grep.parameters.properties.context.maximum).toBe(3);
        expect(grep.parameters.properties.limit.maximum).toBe(20);
        expect(find.parameters.properties.limit.maximum).toBe(20);
    });

    it("checks cancellation after finder initialisation", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const find = findTool(tools, "find");
        const fileSearch = vi.fn();
        const finder: Pick<FileFinderApi, "fileSearch"> = { fileSearch };
        let release!: (finder: FileFinderApi) => void;
        const ensure = vi
            .spyOn(fff, "ensure")
            .mockReturnValue(new Promise((resolve) => (release = resolve)));
        const controller = new AbortController();

        try {
            const execution = find.execute(
                "call",
                { pattern: "file" },
                controller.signal,
                undefined,
                { cwd: "/tmp/project" },
            );
            controller.abort();
            release(finder as unknown as FileFinderApi);

            await expect(execution).rejects.toMatchObject({ name: "AbortError" });
            expect(fileSearch).not.toHaveBeenCalled();
        } finally {
            ensure.mockRestore();
        }
    });

    it("honours requested small limits and context", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const grepTool = findTool(tools, "grep");
        const findToolDefinition = findTool(tools, "find");
        const grep = vi.fn((_query: string, _options?: unknown) => ({
            ok: true,
            value: { items: [], nextCursor: null },
        }));
        const fileSearch = vi.fn((_query: string, _options?: unknown) => ({
            ok: true,
            value: { items: [] },
        }));
        const ensure = vi
            .spyOn(fff, "ensure")
            .mockResolvedValue({ grep, fileSearch } as unknown as FileFinderApi);

        try {
            await grepTool.execute(
                "grep",
                { pattern: "needle", limit: 3, context: 2 },
                undefined,
                undefined,
                { cwd: "/tmp/project" },
            );
            await findToolDefinition.execute(
                "find",
                { pattern: "file", limit: 4 },
                undefined,
                undefined,
                { cwd: "/tmp/project" },
            );

            expect(grep.mock.calls[0]?.[1]).toMatchObject({
                pageSize: 3,
                maxMatchesPerFile: 3,
                beforeContext: 2,
                afterContext: 2,
            });
            expect(fileSearch).toHaveBeenCalledWith(expect.any(String), { pageSize: 4 });
        } finally {
            ensure.mockRestore();
        }
    });

    it("bounds indexed grep execution time", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const tool = findTool(tools, "grep");
        const grep = vi.fn((_query: string, _options?: unknown) => ({
            ok: true,
            value: { items: [], nextCursor: null },
        }));
        const ensure = vi
            .spyOn(fff, "ensure")
            .mockResolvedValue({ grep } as unknown as FileFinderApi);
        const clock = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(4_000);

        try {
            await tool.execute("call", { pattern: "needle" }, undefined, undefined, {
                cwd: "/tmp/project",
            });
            expect(ensure).toHaveBeenCalledWith("/tmp/project", {
                primary: true,
                refresh: true,
            });
            expect(grep.mock.calls[0]?.[1]).toMatchObject({ timeBudgetMs: 10_000 });
            expect(grep.mock.calls[1]?.[1]).toMatchObject({ timeBudgetMs: 7_000 });
        } finally {
            clock.mockRestore();
            ensure.mockRestore();
        }
    });

    it("reports a complete no-result search plainly", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const tool = findTool(tools, "find");
        const ensure = vi.spyOn(fff, "ensure").mockResolvedValue({
            fileSearch: () => ({ ok: true, value: { items: [] } }),
        } as unknown as FileFinderApi);

        try {
            const result = await tool.execute(
                "call",
                { pattern: "missing" },
                undefined,
                undefined,
                {
                    cwd: "/tmp/project",
                },
            );
            expect(result.content[0].text).toBe("No files matched.");
        } finally {
            ensure.mockRestore();
        }
    });

    it("does not report an incomplete grep as a definitive miss", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const tool = findTool(tools, "grep");
        const grep = vi.fn(() => ({
            ok: true,
            value: { items: [], nextCursor: { _offset: 1 } },
        }));
        const ensure = vi
            .spyOn(fff, "ensure")
            .mockResolvedValue({ grep } as unknown as FileFinderApi);

        try {
            const result = await tool.execute("call", { pattern: "needle" }, undefined, undefined, {
                cwd: "/tmp/project",
            });
            expect(grep).toHaveBeenCalledOnce();
            expect(result.content[0].text).toContain("before the search time budget was reached");
        } finally {
            ensure.mockRestore();
        }
    });

    it("marks non-empty grep pages as incomplete", async () => {
        const tools: SearchTool[] = [];
        registerSearch({
            registerTool: (tool: SearchTool) => tools.push(tool),
        } as unknown as ExtensionAPI);
        const tool = findTool(tools, "grep");
        const grep = vi.fn(() => ({
            ok: true,
            value: {
                items: [{ relativePath: "src/a.ts", lineNumber: 1, lineContent: "needle" }],
                nextCursor: { _offset: 1 },
            },
        }));
        const ensure = vi
            .spyOn(fff, "ensure")
            .mockResolvedValue({ grep } as unknown as FileFinderApi);

        try {
            const result = await tool.execute("call", { pattern: "needle" }, undefined, undefined, {
                cwd: "/tmp/project",
            });
            expect(result.content[0].text).toContain("More matches may exist");
        } finally {
            ensure.mockRestore();
        }
    });
});
