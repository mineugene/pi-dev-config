import { type AgentPaneRecord, isAgentPaneRecord } from "../../domain/session-tracker.ts";

export type TrackerRequest =
    | { type: "report" | "heartbeat"; record: AgentPaneRecord }
    | { type: "release"; paneId: string; runtimeId: string }
    | { type: "snapshot" }
    | { type: "focus-pane"; paneId: string; targetClient?: string }
    | { type: "focus-next"; currentPaneId?: string; targetClient?: string }
    | { type: "shutdown" };

export interface TrackerResponse {
    ok: boolean;
    error?: string;
    records?: AgentPaneRecord[];
    paneId?: string;
    shutdown?: boolean;
}

function isString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

export function parseTrackerRequest(value: unknown): TrackerRequest | undefined {
    if (typeof value !== "object" || value === null || !("type" in value)) return undefined;
    const request = value as Record<string, unknown>;
    switch (request.type) {
        case "report":
        case "heartbeat":
            return isAgentPaneRecord(request.record)
                ? { type: request.type, record: request.record }
                : undefined;
        case "release":
            return isString(request.paneId) && isString(request.runtimeId)
                ? { type: "release", paneId: request.paneId, runtimeId: request.runtimeId }
                : undefined;
        case "snapshot":
        case "shutdown":
            return { type: request.type };
        case "focus-pane":
            return isString(request.paneId) &&
                (request.targetClient === undefined || isString(request.targetClient))
                ? {
                      type: "focus-pane",
                      paneId: request.paneId,
                      ...(request.targetClient === undefined
                          ? {}
                          : { targetClient: request.targetClient }),
                  }
                : undefined;
        case "focus-next":
            return (request.currentPaneId === undefined || isString(request.currentPaneId)) &&
                (request.targetClient === undefined || isString(request.targetClient))
                ? {
                      type: "focus-next",
                      ...(request.currentPaneId === undefined
                          ? {}
                          : { currentPaneId: request.currentPaneId }),
                      ...(request.targetClient === undefined
                          ? {}
                          : { targetClient: request.targetClient }),
                  }
                : undefined;
        default:
            return undefined;
    }
}
