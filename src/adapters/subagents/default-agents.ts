/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * These are always available but can be overridden by user .md files with the same name.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "./types.ts";

const SELF_EXTENSION = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    `../index${path.extname(fileURLToPath(import.meta.url))}`,
);

const DEFAULT_EXPLORE_MODEL = "github-copilot/gpt-5.4-mini";

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map([
    [
        "general",
        {
            name: "general",
            displayName: "general",
            description: [
                "General-purpose, write-capable agent for delegated implementation work.",
                "Use when the user explicitly requests a subagent, independent work can run in parallel, or delegation has another concrete stated benefit.",
                "Do not use for ordinary implementation requests merely because they are complex or multi-step; handle those directly in the primary agent.",
                "Avoid blocking foreground delegation when the primary agent can do the work itself.",
            ].join(" "),
            builtinToolNames: ["read", "bash", "edit", "write"],
            extensions: [SELF_EXTENSION],
            // Append mode already inherits the parent's advertised skill catalog.
            skills: false,
            systemPrompt: "",
            promptMode: "append",
            bashGatePolicy: "prompt",
            isDefault: true,
        },
    ],
    [
        "explore",
        {
            name: "explore",
            displayName: "explore",
            description: [
                "Fast read-only codebase reconnaissance in an isolated subagent.",
                "Use after 2-4 targeted tool calls fail to answer a bounded investigation and the next step requires broader searching; pass along what was already checked.",
                "Delegate immediately only when the task is obviously broad, high-fanout, or likely to return enough output to bloat the main context.",
                "Good candidates: tracing a call chain across many files, understanding a feature end-to-end, finding all usages of a pattern, or gathering context before a broad refactor.",
                "Bad candidates: known paths or symbols, a few files the parent will need to read fully to make a change, or a direct search likely to answer the question.",
                "After Explore returns, read only the files needed to act on or verify its findings.",
            ].join(" "),
            builtinToolNames: ["read", "ls", "bash"],
            extensions: [SELF_EXTENSION],
            skills: false,
            model: DEFAULT_EXPLORE_MODEL,
            systemPrompt: `You are Explore, a fast read-only codebase exploration subagent. Investigate efficiently and return objective findings to the parent.

Rules:
- Never modify files or system state, including through temporary files or write-capable commands.
- Stay within the given working directory.
- Search and read only what the task needs; treat checks reported by the parent as done unless verification matters.
- Prefer a few high-value searches and focused reads. Stop when concrete evidence answers the task.
- Report facts, not recommendations or claims that you made changes.
- Give exact paths and useful line ranges. Separate confirmed facts from uncertainty.

Output:
## Summary
A short factual answer.

## Findings
- Evidence, paths, behaviour, types, dependencies, or control flow

## Notes
Caveats, uncertainty, or relevant searches with no result.
`,
            promptMode: "replace",
            bashGatePolicy: "deny",
            isDefault: true,
        },
    ],
]);
