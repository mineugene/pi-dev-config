/**
 * pi-dev-config composition root.
 *
 * Loads config, then registers every feature from the registry that is active
 * for this run mode and not disabled. UI-only (interactive-tier) features are
 * skipped in non-interactive runs (`-p` / `--print`); subagent child processes
 * (spawned with PIDEV_SUBAGENT set) load only the core tier. Config is loaded
 * eagerly here (registration happens before session_start) and refreshed per
 * session so it tracks the real cwd.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ConfigRef, FeatureContext, FeatureTier } from "./adapters/feature.ts";
import { FEATURES } from "./adapters/registry.ts";
import { loadConfig } from "./infra/config.ts";
import { fff } from "./infra/fff.ts";

/** Tiers to load for this process; tiers nest core ⊂ session ⊂ interactive. */
function activeTiers(): Set<FeatureTier> {
    if (process.env.PIDEV_SUBAGENT != null) return new Set(["core"]);
    const isNonInteractive = process.argv.some((arg) => arg === "-p" || arg === "--print");
    if (isNonInteractive) return new Set(["core", "session"]);
    return new Set(["core", "session", "interactive"]);
}

export default function (pi: ExtensionAPI): void {
    // Search is core, so its shared native resources must be torn down here,
    // not by the interactive-only @-mention feature.
    pi.on("session_shutdown", () => {
        fff.dispose();
    });

    const config: ConfigRef = { current: loadConfig(process.cwd()) };
    pi.on("session_start", async (_event, ctx) => {
        config.current = loadConfig(ctx.cwd);
    });

    const disabled = new Set(config.current.disable ?? []);
    const tiers = activeTiers();
    const active = FEATURES.filter(
        (feature) => tiers.has(feature.tier) && !disabled.has(feature.name),
    );
    const activeNames = new Set(active.map((feature) => feature.name));

    const ctx: FeatureContext = {
        config,
        isFeatureEnabled: (name) => activeNames.has(name),
    };

    for (const feature of active) {
        feature.register(pi, ctx);
    }
}
