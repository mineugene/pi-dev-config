/**
 * Sparkle frames for pi's Working indicator.
 *
 * Other built-in spinners are configured by the Nix package patch.
 */

import type { ExtensionAPI, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";

const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const INDICATOR: WorkingIndicatorOptions = { frames: FRAMES, intervalMs: 150 };

export default function registerWorkingIndicator(pi: ExtensionAPI): void {
    pi.on("session_start", (_event, ctx) => {
        ctx.ui.setWorkingIndicator(INDICATOR);
    });
}
