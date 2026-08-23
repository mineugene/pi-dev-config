import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ConfigRef } from "./feature.ts";

const EXPLORATION_TOOLS = new Set(["read", "grep", "find"]);
const EXPLORATION_CALL_THRESHOLD = 12;
const EXPLORATION_PATH_THRESHOLD = 6;

export const GRAPH_USE_POLICY = `## Graphify graph-use policy

A Graphify graph exists for this project. Before broad codebase exploration or an architectural change, query it first: use \`graphify query "<task>"\` for discovery, then \`graphify explain\`, \`path\`, or \`affected\` when they answer the question more directly. Use its output as evidence before falling back to broad \`read\`, \`grep\`, or \`find\` calls. Skip the graph only for a trivial, known-local change. In the final response, name the Graphify command used.`;

export function graphExists(cwd = process.cwd()): boolean {
    return existsSync(join(cwd, "graphify-out", "graph.json"));
}

function inputPath(input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const path = (input as { path?: unknown }).path;
    return typeof path === "string" && path.trim() ? path : undefined;
}

/**
 * Expose Graphify's bundled skill through `/graphify` when explicitly enabled.
 *
 * Graphify's native `hook install` is post-commit and `--watch` is a filesystem
 * watcher. Neither belongs in a pi pre-tool hook: rebuilding before each tool
 * call would be slow, duplicate Graphify's cache work, and can invoke semantic
 * extraction unexpectedly.
 */
export default function registerGraphify(pi: ExtensionAPI, config: ConfigRef): void {
    if (config.current.graphify?.enabled !== true) return;

    pi.on("before_agent_start", async (event, ctx) => {
        if (!graphExists(ctx.cwd) || event.systemPrompt.includes("Graphify graph-use policy"))
            return;
        return { systemPrompt: `${event.systemPrompt}\n\n${GRAPH_USE_POLICY}` };
    });

    // Child agents should query an existing graph, but only the parent queues builds.
    if (process.env.PIDEV_SUBAGENT != null) return;

    let explorationCalls = 0;
    const exploredPaths = new Set<string>();
    let graphQueued = false;

    pi.on("tool_call", (event) => {
        if (graphQueued || !EXPLORATION_TOOLS.has(event.toolName)) return;
        explorationCalls++;
        const path = inputPath(event.input);
        if (path) exploredPaths.add(path);
        if (
            explorationCalls < EXPLORATION_CALL_THRESHOLD ||
            exploredPaths.size < EXPLORATION_PATH_THRESHOLD
        ) {
            return;
        }

        graphQueued = true;
        pi.sendUserMessage(
            "Update the Graphify knowledge graph for the current directory. Run `graphify .` and report the output location and result.",
            {
                deliverAs: "followUp",
            },
        );
    });

    pi.registerCommand("graphify", {
        description: "Build or query a Graphify knowledge graph",
        handler: async (args) => {
            const suffix = args.trim();
            pi.sendUserMessage(`/skill:graphify${suffix ? ` ${suffix}` : ""}`, {
                expandPromptTemplates: true,
            });
        },
    });
}
