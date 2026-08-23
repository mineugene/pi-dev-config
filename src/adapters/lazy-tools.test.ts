import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import registerLazyTools, { DEFERRED_TOOL_NAMES } from "./lazy-tools.ts";

type Tool = {
    name: string;
    execute: (
        id: string,
        params: { query: string },
        signal: undefined,
        update: undefined,
        ctx: unknown,
    ) => Promise<{
        content: [{ type: "text"; text: string }];
        details: { matches: string[]; added: string[] };
    }>;
};

function register(
    active = ["read", "grep", "find", "bash", "edit", "write", ...DEFERRED_TOOL_NAMES],
) {
    const tools: Tool[] = [];
    let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
    let bound = false;
    const configured = new Set([...active, ...DEFERRED_TOOL_NAMES]);
    const api = {
        registerTool: (tool: Tool) => tools.push(tool),
        getActiveTools: () => {
            if (!bound) throw new Error("Extension API is not bound");
            return active;
        },
        getAllTools: () => {
            if (!bound) throw new Error("Extension API is not bound");
            return [
                ...tools,
                ...DEFERRED_TOOL_NAMES.map((name) => ({ name, description: `${name} tool` })),
            ];
        },
        setActiveTools: (next: string[]) => {
            if (!bound) throw new Error("Extension API is not bound");
            active = next.filter(
                (name) => configured.has(name) || tools.some((tool) => tool.name === name),
            );
        },
        on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
            if (event === "session_start") sessionStart = handler;
        },
    } as unknown as ExtensionAPI;
    registerLazyTools(api);
    const tool = tools.find((candidate) => candidate.name === "search_tools");
    if (!tool) throw new Error("search_tools was not registered");
    return {
        active: () => active,
        start: (branch: unknown[] = []) => {
            bound = true;
            sessionStart?.({}, { sessionManager: { getBranch: () => branch } });
        },
        tool,
    };
}

describe("lazy tool exposure", () => {
    it("publishes the optional tool catalogue", () => {
        expect(DEFERRED_TOOL_NAMES).toEqual([
            "Agent",
            "todo",
            "commit",
            "ask_user_question",
            "get_subagent_result",
            "steer_subagent",
        ]);
    });

    it("keeps coding and discovery tools active at session start", () => {
        const { active, start } = register();
        start();

        expect(active()).toEqual(["read", "grep", "find", "bash", "edit", "write", "search_tools"]);
    });

    it("preserves every non-deferred safety tool", () => {
        const { active, start } = register([
            "read",
            "grep",
            "find",
            "bash",
            "edit",
            "write",
            "secret_scan",
            ...DEFERRED_TOOL_NAMES,
        ]);
        start();

        expect(active()).toContain("secret_scan");
    });

    it("activates matching deferred tools additively", async () => {
        const { active, start, tool } = register();
        start();

        const result = await tool.execute(
            "call",
            { query: "signed commit" },
            undefined,
            undefined,
            {},
        );

        expect(result.details).toEqual({ matches: ["commit"], added: ["commit"] });
        expect(active()).toEqual([
            "read",
            "grep",
            "find",
            "bash",
            "edit",
            "write",
            "search_tools",
            "commit",
        ]);
    });

    it("activates Agent by its delegation keywords without loading helpers", async () => {
        const { active, start, tool } = register();
        start();

        await tool.execute("call", { query: "subagent delegation" }, undefined, undefined, {});

        expect(active()).toContain("Agent");
        expect(active()).not.toContain("get_subagent_result");
        expect(active()).not.toContain("steer_subagent");
    });

    it("treats duplicate activation as an additive no-op", async () => {
        const { active, start, tool } = register();
        start();

        await tool.execute("first", { query: "signed commit" }, undefined, undefined, {});
        const result = await tool.execute(
            "second",
            { query: "signed commit" },
            undefined,
            undefined,
            {},
        );

        expect(result.details.added).toEqual([]);
        expect(active().filter((name) => name === "commit")).toHaveLength(1);
    });

    it("restores tools activated earlier on the resumed branch", () => {
        const { active, start } = register();

        start([
            {
                type: "message",
                message: {
                    role: "toolResult",
                    toolName: "search_tools",
                    details: { added: ["commit"] },
                },
            },
        ]);

        expect(active()).toContain("commit");
    });

    it("reports unknown capabilities compactly without changing active tools", async () => {
        const { active, start, tool } = register();
        start();

        const result = await tool.execute(
            "call",
            { query: "database migration" },
            undefined,
            undefined,
            {},
        );

        expect(result.content[0].text).toBe(
            'No deferred tools match "database migration". Try agent, plan, commit, question, result, or steer.',
        );
        expect(active()).toEqual(["read", "grep", "find", "bash", "edit", "write", "search_tools"]);
    });
});
