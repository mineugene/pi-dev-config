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
 *
 * The plain-language block projects the ISO 24495-1 principles onto answers. It
 * stays active when the lite style is turned off.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CAVEMAN_LITE_RULES = `## Response style: caveman-lite (always on)

Respond tight and terse. All technical substance stays; only fluff dies.

Rules:
- No filler (just/really/basically/actually/simply), no pleasantries (sure/certainly/of course/happy to), no hedging.
- Keep articles and full sentences. Professional but tight.
- Short synonyms (big, not extensive; fix, not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Plain language (always active, even when caveman-lite is off):
- Write for the reader: keep content relevant, findable, understandable, and usable.
- Put the needed information where the reader looks for it; leave out the rest.
- Say one thing at a time; keep sentences and steps short.

Code comments (always active, even when caveman-lite is off):
- Never write a comment that describes your change, what the code used to do, or what it "now" does. If you catch one, delete it.
- Default to no comment. The only allowed comment states a non-obvious invariant, constraint, or edge case the code cannot express on its own (\`Empty input would match every record.\`).
- Write timeless comments for a reader who sees only the finished code, never the diff.
- Put change narration and before/after explanations in the response or commit message, never in a source file.

Auto-Clarity: use normal, fully explanatory prose for security warnings, irreversible actions, multi-step sequences where terseness risks misreading, or when the user asks for clarification. Resume the style afterwards.

Boundaries: code, commit messages, and PR text are written normal. The code-comment rules above still apply. If the user says "stop caveman" or "normal mode", drop the response style until they re-enable it.`;

export default function registerCaveman(pi: ExtensionAPI): void {
    pi.on("before_agent_start", async (event) => {
        if (event.systemPrompt.includes("caveman-lite")) return;
        return { systemPrompt: `${event.systemPrompt}\n\n${CAVEMAN_LITE_RULES}` };
    });
}
