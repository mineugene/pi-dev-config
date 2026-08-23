import { describe, expect, it } from "vitest";
import { resolveAgentInvocationConfig, resolveJoinMode } from "../invocation-config.ts";
import type { AgentConfig } from "../types.ts";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        name: "Explore",
        description: "Explore",
        builtinToolNames: ["read"],
        extensions: false,
        skills: false,
        systemPrompt: "Test agent",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
        isolated: false,
        ...overrides,
    };
}

describe("resolveAgentInvocationConfig", () => {
    it("prefers public tool-call params over agent defaults", () => {
        const resolved = resolveAgentInvocationConfig(
            makeConfig({
                model: "provider/config-model",
                thinking: "high",
                inheritContext: false,
                runInBackground: false,
                isolated: false,
                isolation: "worktree",
            }),
            {
                model: "provider/param-model",
                thinking: "minimal",
                inherit_context: true,
                run_in_background: true,
                isolated: true,
                isolation: "worktree",
            },
        );

        expect(resolved.modelInput).toBe("provider/param-model");
        expect(resolved.modelFromParams).toBe(true);
        expect(resolved.thinking).toBe("minimal");
        expect(resolved.inheritContext).toBe(true);
        expect(resolved.runInBackground).toBe(true);
        expect(resolved.isolated).toBe(false);
        expect(resolved.isolation).toBe("worktree");
    });

    it("uses tool-call params when no agent config is available", () => {
        const resolved = resolveAgentInvocationConfig(undefined, {
            model: "provider/param-model",
            thinking: "minimal",
            inherit_context: true,
            run_in_background: true,
            isolated: true,
            isolation: "worktree",
        });

        expect(resolved.modelInput).toBe("provider/param-model");
        expect(resolved.modelFromParams).toBe(true);
        expect(resolved.thinking).toBe("minimal");
        expect(resolved.inheritContext).toBe(true);
        expect(resolved.runInBackground).toBe(true);
        expect(resolved.isolated).toBe(true);
        expect(resolved.isolation).toBe("worktree");
    });

    it("lets parent fill in booleans when config leaves them undefined", () => {
        const config = makeConfig();
        delete config.inheritContext;
        delete config.runInBackground;
        delete config.isolated;
        const resolved = resolveAgentInvocationConfig(config, {
            inherit_context: true,
            run_in_background: true,
            isolated: true,
        });

        expect(resolved.inheritContext).toBe(true);
        expect(resolved.runInBackground).toBe(true);
        expect(resolved.isolated).toBe(true);
    });

    it("defaults booleans to false when neither config nor params set them", () => {
        const config = makeConfig();
        delete config.inheritContext;
        delete config.runInBackground;
        delete config.isolated;
        const resolved = resolveAgentInvocationConfig(config, {});

        expect(resolved.inheritContext).toBe(false);
        expect(resolved.runInBackground).toBe(false);
        expect(resolved.isolated).toBe(false);
    });
});

describe("resolveJoinMode", () => {
    it("returns the global default for background agents", () => {
        expect(resolveJoinMode("smart", true)).toBe("smart");
        expect(resolveJoinMode("async", true)).toBe("async");
    });

    it("ignores join mode for foreground agents", () => {
        expect(resolveJoinMode("smart", false)).toBeUndefined();
        expect(resolveJoinMode("async", false)).toBeUndefined();
    });
});
