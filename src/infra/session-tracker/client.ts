import type { AgentPaneRecord } from "../../domain/session-tracker.ts";
import { trackerPaths } from "./paths.ts";
import type { TrackerRequest, TrackerResponse } from "./protocol.ts";
import { ensureTrackerDaemon } from "./start.ts";
import { sendTrackerRequest } from "./transport.ts";

export { sendTrackerRequest } from "./transport.ts";

type Send = (socketPath: string, request: TrackerRequest) => Promise<TrackerResponse>;

interface TrackerClientOptions {
    socketPath?: string;
    send?: Send;
    start?: () => Promise<boolean>;
}

export class TrackerClient {
    private readonly socketPath: string;
    private readonly send: Send;
    private readonly start: () => Promise<boolean>;

    constructor(options: TrackerClientOptions = {}) {
        this.socketPath = options.socketPath ?? trackerPaths().socket;
        this.send = options.send ?? sendTrackerRequest;
        this.start = options.start ?? ensureTrackerDaemon;
    }

    private async request(
        request: TrackerRequest,
        autoStart = true,
    ): Promise<TrackerResponse | undefined> {
        try {
            return await this.send(this.socketPath, request);
        } catch {
            if (!autoStart || !(await this.start())) return undefined;
            try {
                return await this.send(this.socketPath, request);
            } catch {
                return undefined;
            }
        }
    }

    async report(record: AgentPaneRecord): Promise<boolean> {
        return (await this.request({ type: "report", record }))?.ok === true;
    }

    async heartbeat(record: AgentPaneRecord): Promise<boolean> {
        return (await this.request({ type: "heartbeat", record }))?.ok === true;
    }

    async release(paneId: string, runtimeId: string): Promise<boolean> {
        return (await this.request({ type: "release", paneId, runtimeId }, false))?.ok === true;
    }

    async snapshot(): Promise<AgentPaneRecord[] | undefined> {
        const response = await this.request({ type: "snapshot" });
        return response?.ok ? response.records : undefined;
    }

    async focusPane(paneId: string, targetClient?: string): Promise<TrackerResponse | undefined> {
        return await this.request({
            type: "focus-pane",
            paneId,
            ...(targetClient === undefined ? {} : { targetClient }),
        });
    }

    async focusNext(
        currentPaneId?: string,
        targetClient?: string,
    ): Promise<TrackerResponse | undefined> {
        return await this.request({
            type: "focus-next",
            ...(currentPaneId === undefined ? {} : { currentPaneId }),
            ...(targetClient === undefined ? {} : { targetClient }),
        });
    }

    async shutdown(): Promise<boolean> {
        return (await this.request({ type: "shutdown" }, false))?.ok === true;
    }
}
