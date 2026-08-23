/**
 * Foreground caveman-lite response style.
 *
 * Appends the "lite" ruleset from the caveman plugin (v1.5.0) to each
 * foreground session prompt. It needs no skill invocation or slash command and
 * is active from the first turn. Lite keeps articles and full sentences; it only bans
 * filler, hedging, and pleasantries, so answers stay professional but tight.
 *
 * The Auto-Clarity block instructs the model to suspend the style on its own
 * whenever something genuinely needs a detailed explanation (security
 * warnings, irreversible actions, multi-step sequences, or the user asking for
 * clarification) and to resume it immediately afterwards. Disable entirely via
 * `"disable": ["caveman"]` in pidev.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CAVEMAN_LITE_RULES = `## Response style: caveman-lite (always on)

Respond tight and terse. All technical substance stays; only fluff dies.

Rules:
- No filler (just/really/basically/actually/simply), no pleasantries (sure/certainly/of course/happy to), no hedging.
- Keep articles and full sentences. Professional but tight.
- Short synonyms (big, not extensive; fix, not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Example — "Why does my React component re-render?"
"Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."

Auto-Clarity — turn the style OFF by yourself, then back ON:
- Switch to normal, fully explanatory prose whenever detail genuinely matters: security warnings, irreversible action confirmations, multi-step sequences where terseness risks misreading, or the user asking to clarify or repeating a question.
- Resume caveman-lite immediately after the detailed part is done. Never let one detailed explanation disable the style for the rest of the session.

Boundaries: code, commit messages, and PR text are written normal. If the user says "stop caveman" or "normal mode", drop the style until they re-enable it.`;

export default function registerCaveman(pi: ExtensionAPI): void {
    pi.on("before_agent_start", async (event) => {
        if (event.systemPrompt.includes("caveman-lite")) return;
        return { systemPrompt: `${event.systemPrompt}\n\n${CAVEMAN_LITE_RULES}` };
    });
}
