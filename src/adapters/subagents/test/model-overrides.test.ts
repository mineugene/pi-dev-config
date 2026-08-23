import { beforeEach, describe, expect, test } from "vitest";
import { getAgentConfig, registerAgents } from "../agent-types.ts";
import { applyAgentModelOverrides } from "../model-overrides.ts";

describe("subagent model overrides", () => {
    beforeEach(() => registerAgents(new Map()));

    test("uses routing.fast for the default Explore agent", () => {
        applyAgentModelOverrides({
            routing: { fast: { model: "openai/luna", thinkingLevel: "low" } },
        });

        expect(getAgentConfig("explore")?.model).toBe("openai/luna");
    });

    test("prefers an explicit case-insensitive Explore override", () => {
        applyAgentModelOverrides({
            routing: { fast: "openai/luna" },
            subagents: { Explore: { model: "anthropic/haiku" } },
        });

        expect(getAgentConfig("explore")?.model).toBe("anthropic/haiku");
    });

    test("restores the shipped default, which pins no model, on registry reload", () => {
        applyAgentModelOverrides({ routing: { fast: "openai/luna" } });
        registerAgents(new Map());
        applyAgentModelOverrides({});

        expect(getAgentConfig("explore")?.model).toBeUndefined();
    });
});
