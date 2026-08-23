import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isPiHelpPrompt, stripPiDocumentation } from "../domain/prompt-slim.ts";
import type { PiDevConfig } from "../infra/config.ts";

/** Hide generic Pi help on coding turns while keeping an explicit help path. */
export default function registerPromptSlim(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    pi.on("before_agent_start", (event) => {
        if (configRef.current.promptSlim?.enabled === false || isPiHelpPrompt(event.prompt)) return;
        const systemPrompt = stripPiDocumentation(event.systemPrompt);
        return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
    });

    pi.registerCommand("pi", {
        description: "Ask about Pi using its bundled documentation.",
        handler: async (args) => {
            const question =
                args.trim() || "Show the relevant Pi documentation and help me use Pi.";
            pi.sendUserMessage(`Pi help request: ${question}`);
        },
    });
}
