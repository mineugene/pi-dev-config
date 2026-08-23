import {
    defaultRoutingModelSetting,
    type PiDevConfig,
    routingModelId,
} from "../../infra/config.ts";
import { getAgentConfig } from "./agent-types.ts";

/** Apply explicit per-agent models, then the default routing preset's fast fallback. */
export function applyAgentModelOverrides(config: PiDevConfig): void {
    for (const [type, value] of Object.entries(config.subagents ?? {})) {
        if (!value.model) continue;
        const agent = getAgentConfig(type);
        if (agent) agent.model = value.model;
    }

    const explore = getAgentConfig("explore");
    const exploreOverride = Object.entries(config.subagents ?? {}).find(
        ([type]) => type.toLowerCase() === "explore",
    )?.[1].model;
    const fastModel = routingModelId(defaultRoutingModelSetting(config.routing, "fast"));
    if (explore?.isDefault && !exploreOverride && fastModel) explore.model = fastModel;
}
