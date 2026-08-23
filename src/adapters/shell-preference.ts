/**
 * Prefer modern search tools in Bash.
 *
 * The stock Bash snippet lists `grep` and `find`, which nudges the model toward
 * the GNU tools even when `rg` and `fd` are installed. This rewrites the snippet
 * and adds a guideline for whichever replacements resolve on PATH; when neither
 * is present the prompt is untouched. Disable with `"disable": ["shellPreference"]`
 * in pidev.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { formatShellPreference, rewriteBashSnippet } from "../domain/shell-preference.ts";
import { commandAvailable } from "../infra/command-availability.ts";

export default function registerShellPreference(pi: ExtensionAPI): void {
    pi.on("before_agent_start", (event) => {
        const available = { rg: commandAvailable("rg"), fd: commandAvailable("fd") };
        const guideline = formatShellPreference(available);
        if (guideline === undefined) return;
        const options = event.systemPromptOptions;
        const snippet = options.toolSnippets.bash;
        if (snippet !== undefined)
            options.toolSnippets.bash = rewriteBashSnippet(snippet, available);
        options.promptGuidelines.push(guideline);
    });
}
