import { describe, expect, it } from "vitest";

import { addDeferredTools, searchDeferredTools } from "./lazy-tools.ts";

describe("deferred tool search", () => {
    const tools = [
        {
            name: "Agent",
            description: "Launch an autonomous agent for independent work.",
            keywords: ["subagent", "delegation"],
        },
        {
            name: "commit",
            description: "Create a signed git commit from staged changes.",
            keywords: ["git", "signed"],
        },
    ];

    it("finds a deferred tool by keyword", () => {
        expect(searchDeferredTools("subagent delegation", tools)).toEqual(["Agent"]);
    });

    it("returns only the best matches instead of every partial match", () => {
        expect(
            searchDeferredTools("subagent delegation", [
                ...tools,
                {
                    name: "get_subagent_result",
                    description: "Get a subagent result.",
                    keywords: ["background", "status"],
                },
            ]),
        ).toEqual(["Agent"]);
    });

    it("finds a deferred tool by name and description", () => {
        expect(searchDeferredTools("signed commit", tools)).toEqual(["commit"]);
    });

    it("returns no match for an unknown capability", () => {
        expect(searchDeferredTools("database migration", tools)).toEqual([]);
    });

    it("adds matching tools without removing or duplicating active tools", () => {
        expect(addDeferredTools(["read", "Agent"], ["Agent", "commit"])).toEqual([
            "read",
            "Agent",
            "commit",
        ]);
    });
});
