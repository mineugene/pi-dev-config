/**
 * custom-agents.ts — Load user-defined agents from project (.pi/agents/) and global ($PI_CODING_AGENT_DIR/agents/, default ~/.pi/agent/agents/) locations.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.ts";
import type { AgentConfig, BashGatePolicy } from "./types.ts";

/**
 * Scan for custom agent .md files from multiple locations.
 * Discovery hierarchy (higher priority wins):
 *   1. Project: <cwd>/.pi/agents/*.md
 *   2. Global:  $PI_CODING_AGENT_DIR/agents/*.md (default: ~/.pi/agent/agents/*.md)
 *
 * Project-level agents override global ones with the same name.
 * Any name is allowed — names matching defaults (e.g. "Explore") override them.
 */
export function loadCustomAgents(cwd: string): Map<string, AgentConfig> {
    const globalDir = join(getAgentDir(), "agents");
    const projectDir = join(cwd, CONFIG_DIR_NAME, "agents");

    const agents = new Map<string, AgentConfig>();
    loadFromDir(globalDir, agents, "global"); // lower priority
    loadFromDir(projectDir, agents, "project"); // higher priority (overwrites)
    return agents;
}

/** Load agent configs from a directory into the map. */
function loadFromDir(
    dir: string,
    agents: Map<string, AgentConfig>,
    source: "project" | "global",
): void {
    if (!existsSync(dir)) return;

    let files: string[];
    try {
        files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
        return;
    }

    for (const file of files) {
        const name = basename(file, ".md");

        let content: string;
        try {
            content = readFileSync(join(dir, file), "utf-8");
        } catch {
            continue;
        }

        const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(content);
        const displayName = str(fm.display_name);
        const disallowedTools = csvListOptional(fm.disallowed_tools);
        const model = str(fm.model);
        const thinking = str(fm.thinking);
        const persistSession = fm.persist_session != null ? fm.persist_session === true : undefined;
        const sessionDir = str(fm.session_dir);
        const inheritContext = fm.inherit_context != null ? fm.inherit_context === true : undefined;
        const runInBackground =
            fm.run_in_background != null ? fm.run_in_background === true : undefined;
        const isolated = fm.isolated != null ? fm.isolated === true : undefined;
        const bashGatePolicy = parseBashGatePolicy(fm.bash_gate);
        const isolation = fm.isolation === "worktree" ? "worktree" : undefined;

        agents.set(name, {
            name,
            ...(displayName !== undefined ? { displayName } : {}),
            description: str(fm.description) ?? name,
            builtinToolNames: parseToolsField(fm.tools),
            ...(disallowedTools !== undefined ? { disallowedTools } : {}),
            extensions: inheritField(fm.extensions ?? fm.inherit_extensions),
            skills: inheritField(fm.skills ?? fm.inherit_skills),
            ...(model !== undefined ? { model } : {}),
            ...(thinking !== undefined ? { thinking } : {}),
            ...(persistSession !== undefined ? { persistSession } : {}),
            ...(sessionDir !== undefined ? { sessionDir } : {}),
            systemPrompt: body.trim(),
            promptMode: fm.prompt_mode === "append" ? "append" : "replace",
            ...(inheritContext !== undefined ? { inheritContext } : {}),
            ...(runInBackground !== undefined ? { runInBackground } : {}),
            ...(isolated !== undefined ? { isolated } : {}),
            ...(bashGatePolicy !== undefined ? { bashGatePolicy } : {}),
            ...(isolation !== undefined ? { isolation } : {}),
            enabled: fm.enabled !== false, // default true; explicitly false disables
            source,
        });
    }
}

// ---- Field parsers ----
// All follow the same convention: omitted → default, "none"/empty → nothing, value → exact.

/** Extract a string or undefined. */
function str(val: unknown): string | undefined {
    return typeof val === "string" ? val : undefined;
}

/**
 * Parse a raw CSV field value into items, or undefined if absent/empty/"none".
 */
function parseCsvField(val: unknown): string[] | undefined {
    if (val === undefined || val === null) return undefined;
    if (
        typeof val !== "string" &&
        typeof val !== "number" &&
        typeof val !== "boolean" &&
        !Array.isArray(val)
    )
        return undefined;
    const s = Array.isArray(val) ? val.join(",") : String(val).trim();
    if (!s || s === "none") return undefined;
    const items = s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    return items.length > 0 ? items : undefined;
}

/**
 * Parse a comma-separated list field with defaults.
 * omitted → defaults; "none"/empty → []; csv → listed items.
 */
function csvList(val: unknown, defaults: string[]): string[] {
    if (val === undefined || val === null) return defaults;
    return parseCsvField(val) ?? [];
}

/**
 * Parse the built-in tool allowlist. `*` and `all` expand to all built-ins.
 */
function parseToolsField(val: unknown): string[] {
    const entries = csvList(val, BUILTIN_TOOL_NAMES);
    const isWildcard = (e: string) => e === "*" || e.toLowerCase() === "all";
    const hasWildcard = entries.some(isWildcard);
    const names = entries.filter((e) => !isWildcard(e));
    return hasWildcard ? [...new Set([...BUILTIN_TOOL_NAMES, ...names])] : names;
}

/**
 * Parse an optional comma-separated list field.
 * omitted → undefined; "none"/empty → undefined; csv → listed items.
 */
function csvListOptional(val: unknown): string[] | undefined {
    return parseCsvField(val);
}

function parseBashGatePolicy(val: unknown): BashGatePolicy | undefined {
    if (val === "deny" || val === "prompt") return val;
    return undefined;
}

/**
 * Parse an inherit field (extensions, skills).
 * omitted/true → true (inherit all); false/"none"/empty → false; csv → listed names.
 */
function inheritField(val: unknown): true | string[] | false {
    if (val === undefined || val === null || val === true) return true;
    if (val === false || val === "none") return false;
    const items = csvList(val, []);
    return items.length > 0 ? items : false;
}
