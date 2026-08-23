import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatGraphStatus, graphHasFailure } from "../domain/graphify.ts";
import { graphExists, readGraphStatus } from "../infra/graphify.ts";
import type { ConfigRef } from "./feature.ts";

export { graphExists } from "../infra/graphify.ts";

export const GRAPH_USE_POLICY = `## Graphify graph-use policy

A Graphify graph exists for this project. Before broad codebase exploration or an architectural change, query it first: use \`graphify query "<task>"\` for discovery, then \`graphify explain\`, \`path\`, or \`affected\` when they answer the question more directly. Use its output as evidence before falling back to broad \`read\`, \`grep\`, or \`find\` calls. Skip the graph only when the change is known-local and no exploration is required. In the final response, name the Graphify command used.

Check \`graphify-out/needs_update\` and any failures in \`graphify-out/.graphify_status.json\` before using graph results. When pending semantics, recorded failures, or unreadable signals exist, graph results are stale: treat them as leads and verify relevant source files before drawing conclusions. Run the local \`/graphify status\` command to inspect details without invoking an LLM. Do not refresh or extract automatically, including after refactoring. Only an explicit user update or build request authorises refresh or extraction, subject to existing permissions. \`graphify update <path>\` refreshes code without an LLM; pending non-code semantics require \`graphify extract <path>\`, which uses LLM tokens. Never delete the marker or claim freshness from a successful command alone.`;

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
        if (
            config.current.graphify?.enabled !== true ||
            !graphExists(ctx.cwd) ||
            event.systemPrompt.includes("Graphify graph-use policy")
        )
            return;
        return { systemPrompt: `${event.systemPrompt}\n\n${GRAPH_USE_POLICY}` };
    });

    // Child agents receive the policy, but only the parent exposes the slash command.
    if (process.env.PIDEV_SUBAGENT != null) return;

    pi.registerCommand("graphify", {
        description: "Show local status, or build or query a Graphify knowledge graph",
        handler: async (args, ctx) => {
            const suffix = args.trim();
            if (suffix === "status") {
                const status = readGraphStatus(ctx.cwd);
                ctx.ui.notify(
                    formatGraphStatus(status, ctx.cwd),
                    graphHasFailure(status) ? "error" : "info",
                );
                return;
            }
            pi.sendUserMessage(`/skill:graphify${suffix ? ` ${suffix}` : ""}`, {
                expandPromptTemplates: true,
            });
        },
    });
}
