import {
    type AgentConfig,
    type IsolationMode,
    isThinkingLevel,
    type JoinMode,
    type ThinkingLevel,
} from "./types.ts";

interface AgentInvocationParams {
    model?: string;
    thinking?: string;
    run_in_background?: boolean;
    inherit_context?: boolean;
    isolated?: boolean;
    isolation?: IsolationMode;
}

export function resolveAgentInvocationConfig(
    agentConfig: AgentConfig | undefined,
    params: AgentInvocationParams,
): {
    modelInput?: string;
    modelFromParams: boolean;
    thinking?: ThinkingLevel;
    inheritContext: boolean;
    runInBackground: boolean;
    isolated: boolean;
    isolation?: IsolationMode;
} {
    const modelInput = params.model ?? agentConfig?.model;
    const thinking = isThinkingLevel(params.thinking)
        ? params.thinking
        : isThinkingLevel(agentConfig?.thinking)
          ? agentConfig.thinking
          : undefined;
    const isolation = params.isolation ?? agentConfig?.isolation;
    return {
        ...(modelInput !== undefined ? { modelInput } : {}),
        modelFromParams: params.model != null,
        ...(thinking !== undefined ? { thinking } : {}),
        inheritContext: params.inherit_context ?? agentConfig?.inheritContext ?? false,
        runInBackground: params.run_in_background ?? agentConfig?.runInBackground ?? false,
        isolated: agentConfig?.isolated ?? params.isolated ?? false,
        ...(isolation !== undefined ? { isolation } : {}),
    };
}

export function resolveJoinMode(
    defaultJoinMode: JoinMode,
    runInBackground: boolean,
): JoinMode | undefined {
    return runInBackground ? defaultJoinMode : undefined;
}
