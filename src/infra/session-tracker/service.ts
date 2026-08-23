import {
    type AgentPaneRecord,
    applyReport,
    formatSessionSummary,
    pruneRecords,
    releaseRecord,
    sortByAttention,
} from "../../domain/session-tracker.ts";
import type { PaneMetadata } from "../tmux.ts";
import type { TrackerRequest, TrackerResponse } from "./protocol.ts";

const DEFAULT_STALE_MS = 30_000;

export type TrackerTmux = {
    clearPaneMetadata(paneId: string, runtimeId: string): Promise<boolean>;
    focusPane(paneId: string, targetClient?: string): Promise<boolean>;
    listPaneIds(): Promise<Set<string>>;
    readAllPaneMetadata(): Promise<Array<{ paneId: string; metadata: PaneMetadata }>>;
    setPaneMetadata(paneId: string, metadata: PaneMetadata): Promise<void>;
};

interface ServiceOptions {
    now?: () => number;
    staleMs?: number;
    writeStatus?: (status: string) => Promise<void>;
}

function paneMetadata(record: AgentPaneRecord): PaneMetadata {
    return {
        runtimeId: record.runtimeId,
        cwd: record.cwd,
        state: record.state,
        ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
        ...(record.title === undefined ? {} : { title: record.title }),
        ...(record.role === undefined ? {} : { role: record.role }),
        ...(record.group === undefined ? {} : { group: record.group }),
        ...(record.parentPaneId === undefined ? {} : { parentPaneId: record.parentPaneId }),
    };
}

export class SessionTrackerService {
    private records = new Map<string, AgentPaneRecord>();
    private readonly tmux: TrackerTmux;
    private readonly now: () => number;
    private readonly staleMs: number;
    private readonly writeStatus: (status: string) => Promise<void>;
    private lastProjection: string | undefined;

    constructor(tmux: TrackerTmux, options: ServiceOptions = {}) {
        this.tmux = tmux;
        this.now = options.now ?? Date.now;
        this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
        this.writeStatus = options.writeStatus ?? (async () => {});
    }

    private async projectStatus(force = false): Promise<void> {
        const status = formatSessionSummary(this.records.values());
        if (!force && status === this.lastProjection) return;
        try {
            await this.writeStatus(status);
            this.lastProjection = status;
        } catch {
            // The status projection is optional; tracking remains useful without it.
        }
    }

    async prune(refreshProjection = false): Promise<void> {
        let livePaneIds: Set<string> | undefined;
        try {
            livePaneIds = await this.tmux.listPaneIds();
        } catch {
            // tmux may be restarting. Staleness still bounds orphaned records.
        }
        const previous = this.records;
        const records = pruneRecords(previous.values(), this.now(), this.staleMs, livePaneIds);
        this.records = new Map(records.map((record) => [record.paneId, record]));
        await Promise.all(
            [...previous.values()]
                .filter((record) => !this.records.has(record.paneId))
                .map(async (record) => {
                    try {
                        await this.tmux.clearPaneMetadata(record.paneId, record.runtimeId);
                    } catch {
                        // Dead panes and a restarting tmux server need no cleanup.
                    }
                }),
        );
        await this.projectStatus(refreshProjection);
    }

    async seedFromTmux(): Promise<void> {
        try {
            const now = this.now();
            for (const { paneId, metadata } of await this.tmux.readAllPaneMetadata()) {
                this.records.set(paneId, {
                    paneId,
                    ...metadata,
                    seq: 0,
                    heartbeatAt: now,
                });
            }
        } catch {
            // Recovery hints are optional. Live reports will populate the daemon.
        }
        await this.projectStatus();
    }

    async handle(request: TrackerRequest): Promise<TrackerResponse> {
        switch (request.type) {
            case "report":
            case "heartbeat": {
                const next = applyReport(this.records, request.record);
                const accepted = next.get(request.record.paneId) === request.record;
                this.records = next;
                if (accepted) {
                    try {
                        await this.tmux.setPaneMetadata(
                            request.record.paneId,
                            paneMetadata(request.record),
                        );
                    } catch {
                        // Metadata is a recovery hint, not authoritative state.
                    }
                }
                await this.projectStatus();
                return { ok: true };
            }
            case "release": {
                const current = this.records.get(request.paneId);
                if (current && current.runtimeId !== request.runtimeId) return { ok: true };
                this.records = releaseRecord(this.records, request.paneId, request.runtimeId);
                try {
                    await this.tmux.clearPaneMetadata(request.paneId, request.runtimeId);
                } catch {
                    // The pane may already be gone.
                }
                await this.projectStatus();
                return { ok: true };
            }
            case "snapshot":
                await this.prune();
                return { ok: true, records: sortByAttention(this.records.values()) };
            case "focus-pane": {
                await this.prune();
                if (!this.records.has(request.paneId)) {
                    return { ok: false, error: "Tracked pane no longer exists." };
                }
                const focused = await this.tmux.focusPane(request.paneId, request.targetClient);
                return focused
                    ? { ok: true, paneId: request.paneId }
                    : { ok: false, error: "Tracked pane no longer exists." };
            }
            case "focus-next": {
                await this.prune();
                const records = sortByAttention(this.records.values());
                if (records.length === 0) return { ok: false, error: "No tracked Pi panes." };
                const currentIndex = request.currentPaneId
                    ? records.findIndex(({ paneId }) => paneId === request.currentPaneId)
                    : -1;
                const next = records[(currentIndex + 1) % records.length];
                if (!next) return { ok: false, error: "No tracked Pi panes." };
                const focused = await this.tmux.focusPane(next.paneId, request.targetClient);
                return focused
                    ? { ok: true, paneId: next.paneId }
                    : { ok: false, error: "Tracked pane no longer exists." };
            }
            case "shutdown":
                return { ok: true, shutdown: true };
        }
    }
}
