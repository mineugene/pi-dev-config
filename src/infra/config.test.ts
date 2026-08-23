import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    defaultRoutingModelSetting,
    loadConfig,
    type PiDevConfig,
    routingModelId,
} from "./config.ts";

describe("routingModelId", () => {
    it("accepts compact and detailed routing model settings", () => {
        expect(routingModelId(" openai/luna ")).toBe("openai/luna");
        expect(routingModelId({ model: " openai/sol ", thinkingLevel: "max" })).toBe("openai/sol");
        expect(routingModelId({ model: "   " })).toBeUndefined();
    });
});

describe("defaultRoutingModelSetting", () => {
    it("reads roles from the named default preset", () => {
        const routing: NonNullable<PiDevConfig["routing"]> = {
            defaultPreset: "general",
            presets: {
                general: { base: "openai/terra", fast: "openai/luna", deep: "openai/sol" },
            },
        };

        expect(defaultRoutingModelSetting(routing, "fast")).toBe("openai/luna");
    });
});

describe("loadConfig merge", () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    let agentDir: string;
    let projectDir: string;

    beforeEach(() => {
        agentDir = mkdtempSync(join(tmpdir(), "pidev-global-"));
        projectDir = mkdtempSync(join(tmpdir(), "pidev-project-"));
        mkdirSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });
        process.env.PI_CODING_AGENT_DIR = agentDir;
    });

    afterEach(() => {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        rmSync(agentDir, { recursive: true, force: true });
        rmSync(projectDir, { recursive: true, force: true });
    });

    const writeGlobal = (config: PiDevConfig): void =>
        writeFileSync(join(agentDir, "pidev.json"), JSON.stringify(config));
    const writeProject = (config: PiDevConfig): void =>
        writeFileSync(join(projectDir, CONFIG_DIR_NAME, "pidev.json"), JSON.stringify(config));

    it("unions list fields (disable, read.grepGateBypass) across global + project, de-duped", () => {
        writeGlobal({ disable: ["vim"], read: { grepGateBypass: ["pdf", "zip"] } });
        writeProject({ disable: ["vim", "rtk"], read: { grepGateBypass: ["wasm"] } });
        const config = loadConfig(projectDir);
        expect(config.disable).toEqual(["vim", "rtk"]);
        expect(config.read?.grepGateBypass).toEqual(["pdf", "zip", "wasm"]);
    });

    it("merges nested objects key by key; project scalars win", () => {
        writeGlobal({
            statusline: { command: "global-script" },
            commitSign: { mode: "warn", minTimeoutSec: 60 },
        });
        writeProject({ commitSign: { mode: "block" } });
        const config = loadConfig(projectDir);
        expect(config.statusline?.command).toBe("global-script");
        expect(config.commitSign).toEqual({ mode: "block", minTimeoutSec: 60 });
    });

    it("merges web search and reader settings by key", () => {
        writeGlobal({
            web: { search: { limit: 5 }, read: { maxTokens: 6000 } },
        });
        writeProject({ web: { read: { timeoutMs: 8_000 } } });

        expect(loadConfig(projectDir).web).toEqual({
            search: { limit: 5 },
            read: { maxTokens: 6000, timeoutMs: 8_000 },
        });
    });

    it("unions bashGate.rules across global + project", () => {
        writeGlobal({ bashGate: { rules: [{ cmd: "terraform" }] } });
        writeProject({ bashGate: { rules: [{ cmd: "kubectl", subcommands: ["delete"] }] } });
        const config = loadConfig(projectDir);
        expect(config.bashGate?.rules).toEqual([
            { cmd: "terraform" },
            { cmd: "kubectl", subcommands: ["delete"] },
        ]);
    });

    it("merges routing targets and effort by key", () => {
        writeGlobal({
            routing: {
                fast: { model: "luna", thinkingLevel: "low" },
                deep: { model: "sol", thinkingLevel: "max" },
                failureThreshold: 2,
                correctionThreshold: 2,
                cacheTtlMinutes: 5,
            },
        });
        writeProject({ routing: { failureThreshold: 3, cacheTtlMinutes: 10 } });

        expect(loadConfig(projectDir).routing).toEqual({
            fast: { model: "luna", thinkingLevel: "low" },
            deep: { model: "sol", thinkingLevel: "max" },
            failureThreshold: 3,
            correctionThreshold: 2,
            cacheTtlMinutes: 10,
        });
    });

    it("merges named routing presets and lets the project select the default", () => {
        writeGlobal({
            routing: {
                defaultPreset: "general",
                presets: {
                    general: { base: "terra", fast: "luna", deep: "sol" },
                },
            },
        });
        writeProject({
            routing: {
                defaultPreset: "github-copilot",
                presets: {
                    general: { base: "project-terra" },
                    "github-copilot": { base: "copilot/terra", fast: "copilot/luna" },
                },
            },
        });

        expect(loadConfig(projectDir).routing).toEqual({
            defaultPreset: "github-copilot",
            presets: {
                general: { base: "project-terra", fast: "luna", deep: "sol" },
                "github-copilot": { base: "copilot/terra", fast: "copilot/luna" },
            },
        });
    });

    it("falls back to defaults when a file is missing", () => {
        writeProject({ vim: { enabled: true } }); // no global file at all
        const config = loadConfig(projectDir);
        expect(config.vim?.enabled).toBe(true);
        expect(config.disable).toBeUndefined();
    });
});
