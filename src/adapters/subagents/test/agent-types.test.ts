import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../agent-manager.ts";
import { getAgentConfig, getAvailableTypes, getConfig, registerAgents } from "../agent-types.ts";
import { registerAgentTool } from "../register-agent-tool.ts";
import type { AgentConfig } from "../types.ts";
import type { FleetList } from "../ui/fleet-list.ts";

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        name: "test-agent",
        description: "Test agent",
        builtinToolNames: ["read", "grep"],
        extensions: false,
        skills: false,
        systemPrompt: "You are a test agent.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
        isolated: false,
        ...overrides,
    };
}

describe("agent type registry", () => {
    beforeEach(() => {
        registerAgents(new Map());
    });

    it("configures the built-in general agent", () => {
        const config = getConfig("general");

        expect(config.builtinToolNames).toEqual(["read", "bash", "edit", "write"]);
        expect(config.extensions).toEqual([expect.stringMatching(/[\\/]index\.(ts|js)$/)]);
        expect(config.skills).toBe(false);
        expect(config.promptMode).toBe("append");
    });

    it("scopes default explore to the bundled extension", () => {
        const config = getConfig("explore");

        expect(config.builtinToolNames).toEqual(["read", "ls", "bash"]);
        expect(config.extensions).toEqual([expect.stringMatching(/[\\/]index\.(ts|js)$/)]);
        expect(config.skills).toBe(false);
    });

    it("labels an explicit empty built-in tool scope as none", () => {
        registerAgents(
            new Map([
                [
                    "none",
                    makeAgentConfig({
                        name: "none",
                        description: "No tools.",
                        builtinToolNames: [],
                    }),
                ],
            ]),
        );
        let description = "";
        registerAgentTool(
            {
                events: { on: vi.fn(), emit: vi.fn() },
                registerTool: vi.fn((tool) => {
                    description = tool.description;
                }),
            } as unknown as ExtensionAPI,
            {
                manager: {
                    getRecord: vi.fn(),
                    setMaxConcurrent: vi.fn(),
                } as unknown as AgentManager,
                agentActivity: new Map(),
                fleet: {} as unknown as FleetList,
                reloadCustomAgents: vi.fn(),
                isScopeModelsEnabled: () => false,
                setDefaultJoinMode: vi.fn(),
                setScopeModelsEnabled: vi.fn(),
                setDisableDefaultAgents: vi.fn(),
                setFleetViewEnabled: vi.fn(),
                getDefaultJoinMode: () => "smart",
                trackSpawned: vi.fn(),
            },
        );

        expect(description).toContain("- none: No tools. (Tools: none)");
    });

    describe("user agents", () => {
        it("registers and retrieves user agents", () => {
            registerAgents(
                new Map([
                    ["auditor", makeAgentConfig({ name: "auditor", description: "Auditor" })],
                ]),
            );

            expect(getAgentConfig("auditor")?.description).toBe("Auditor");
        });

        it("includes user agents in available types", () => {
            registerAgents(new Map([["auditor", makeAgentConfig({ name: "auditor" })]]));

            expect(getAvailableTypes()).toContain("auditor");
        });

        it("getConfig returns config for user agents", () => {
            registerAgents(
                new Map([
                    [
                        "auditor",
                        makeAgentConfig({
                            name: "auditor",
                            description: "Security auditor",
                            builtinToolNames: ["read", "grep"],
                            extensions: false,
                            skills: true,
                        }),
                    ],
                ]),
            );

            const config = getConfig("auditor");
            expect(config.displayName).toBe("auditor");
            expect(config.description).toBe("Security auditor");
            expect(config.builtinToolNames).toEqual(["read", "grep"]);
            expect(config.extensions).toBe(false);
            expect(config.skills).toBe(true);
        });

        it("clearing user agents works", () => {
            registerAgents(new Map([["auditor", makeAgentConfig({ name: "auditor" })]]));
            expect(getAgentConfig("auditor")).toBeDefined();

            registerAgents(new Map());
            expect(getAgentConfig("auditor")).toBeUndefined();
        });

        it("disabled agent is excluded from available types", () => {
            registerAgents(
                new Map([["auditor", makeAgentConfig({ name: "auditor", enabled: false })]]),
            );

            expect(getAvailableTypes()).not.toContain("auditor");
        });
    });
});
