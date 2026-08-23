/**
 * End-of-turn notifications.
 *
 * Fires when the agent loop finishes and when another extension asks for
 * attention by emitting on the "pidev:notify" event bus channel (the bash gate
 * does this while it waits for approval):
 *
 *   pi.events.emit("pidev:notify", { cwd, message })
 *
 * Channels, per `notifications.mode` in pidev.json (default "both"):
 *   - terminal bell (BEL to stdout) — works everywhere, including over SSH
 *   - notify-send (Linux/WSLg) or osascript (macOS) — only attempted when a
 *     graphical session is detectable, and always fire-and-forget
 */

import { spawn } from "node:child_process";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractLastAssistantText } from "../domain/messages.ts";
import type { NotificationMode, PiDevConfig } from "../infra/config.ts";

export interface NotifyPayload {
    cwd: string;
    message: string;
}

/** A desktop notifier is worth attempting only inside a graphical session. */
export function hasGraphicalSession(env: NodeJS.ProcessEnv = process.env): boolean {
    if (process.platform === "darwin") return true;
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

function ringBell(): void {
    process.stdout.write("\u0007");
}

function desktopNotify(title: string, body?: string): void {
    try {
        if (process.platform === "darwin") {
            const script = `display notification ${JSON.stringify(body ?? "")} with title ${JSON.stringify(title)}`;
            spawn("osascript", ["-e", script], { stdio: "ignore" }).on("error", () => {});
        } else {
            const args = body ? [title, body] : [title];
            spawn("notify-send", args, { stdio: "ignore" }).on("error", () => {});
        }
    } catch {
        // Fire-and-forget: a missing notifier must never take the session down.
    }
}

export function notifyWithMode(mode: NotificationMode, payload: NotifyPayload): void {
    if (mode === "off") return;
    if (mode === "bell" || mode === "both") ringBell();
    if ((mode === "desktop" || mode === "both") && hasGraphicalSession()) {
        desktopNotify(`pi — ${payload.cwd}`, payload.message);
    }
}

export default function registerNotifications(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    function notify(payload: NotifyPayload): void {
        notifyWithMode(configRef.current.notifications?.mode ?? "both", payload);
    }

    pi.events.on("pidev:notify", (data) => notify(data as NotifyPayload));

    pi.events.on("pidev:bash_gate", (data) => {
        const { cwd, command } = data as { cwd: string; command: string };
        notify({ cwd, message: `Waiting for bash approval: ${command}` });
    });

    pi.on("agent_end", (event, ctx) => {
        notify({
            cwd: ctx.cwd,
            message: extractLastAssistantText(event.messages) ?? "Agent finished",
        });
    });
}
