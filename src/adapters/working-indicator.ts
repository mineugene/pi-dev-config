import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FRAMES = ["⠀⠶⠀", "⠰⣿⠆", "⢾⣉⡷", "⣏⠀⣹", "⡁⠀⢈"];
const INTERVAL_MS = 180;

export default function registerWorkingIndicator(pi: ExtensionAPI): void {
    pi.on("session_start", (_event, ctx) => {
        ctx.ui.setWorkingIndicator({ frames: FRAMES, intervalMs: INTERVAL_MS });
    });
}
