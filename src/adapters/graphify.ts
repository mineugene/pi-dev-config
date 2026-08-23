import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ConfigRef } from "./feature.ts";

export const GRAPH_USE_POLICY = `## Graphify graph-use policy

A Graphify graph exists for this project. Before broad codebase exploration or an architectural change, query it first: use \`graphify query "<task>"\` for discovery, then \`graphify explain\`, \`path\`, or \`affected\` when they answer the question more directly. Use its output as evidence before falling back to broad \`read\`, \`grep\`, or \`find\` calls. Skip the graph only for a trivial, known-local change. In the final response, name the Graphify command used.`;

export function graphExists(cwd = process.cwd()): boolean {
    return existsSync(join(cwd, "graphify-out", "graph.json"));
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

    // Child agents receive the policy, but only the parent exposes the slash command.
    if (process.env.PIDEV_SUBAGENT != null) return;

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
