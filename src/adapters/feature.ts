/**
 * Feature contract.
 *
 * Every extension is exposed to the composition root as a `Feature`: a name, the
 * run-mode tier it belongs to, and a `register` that binds it to pi, pulling any
 * dependencies from the `FeatureContext`. Adding a feature is adding one entry to
 * the registry (adapters/registry.ts) — nothing else here changes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { PiDevConfig } from "../infra/config.ts";

/** Live config handle, re-pointed per session so features track the real cwd. */
export type ConfigRef = { current: PiDevConfig };

/**
 * Run modes a feature loads in. Tiers nest: core ⊂ session ⊂ interactive.
 *   - core        every run, including `-p` / `--print` and subagent children (tools + gates).
 *   - session     full sessions only (not subagent children); headless-safe commands/hooks.
 *   - interactive UI features; skipped under `-p` / `--print`.
 */
export type FeatureTier = "core" | "session" | "interactive";

/** What the composition root hands each feature's `register`. */
export interface FeatureContext {
    /** Live config, reloaded on session_start so it tracks the session cwd. */
    readonly config: ConfigRef;
    /** Whether another active feature is enabled; for editor-slot coordination (paste vs vim). */
    isFeatureEnabled(name: string): boolean;
}

/** One registrable feature. */
export interface Feature {
    readonly name: string;
    readonly tier: FeatureTier;
    register(pi: ExtensionAPI, ctx: FeatureContext): void;
}
