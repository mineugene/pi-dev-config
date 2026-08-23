export const AGENT_PANE_STATES = ["idle", "working", "needs-input", "needs-permission"] as const;

export type AgentPaneState = (typeof AGENT_PANE_STATES)[number];

export interface AgentPaneRecord {
    paneId: string;
    runtimeId: string;
    sessionId?: string;
    cwd: string;
    state: AgentPaneState;
    seq: number;
    heartbeatAt: number;
    title?: string;
    role?: string;
    group?: string;
    parentPaneId?: string;
}

const STATE_PRIORITY: Record<AgentPaneState, number> = {
    "needs-permission": 0,
    "needs-input": 1,
    working: 2,
    idle: 3,
};

export function isAgentPaneState(value: unknown): value is AgentPaneState {
    return typeof value === "string" && AGENT_PANE_STATES.includes(value as AgentPaneState);
}

function boundedString(value: unknown, maxLength: number, allowEmpty = true): value is string {
    return (
        typeof value === "string" &&
        (allowEmpty || value.length > 0) &&
        value.length <= maxLength &&
        !value.includes("\0")
    );
}

function optionalString(value: unknown, maxLength: number): boolean {
    return value === undefined || boundedString(value, maxLength);
}

export function isAgentPaneRecord(value: unknown): value is AgentPaneRecord {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<AgentPaneRecord>;
    return (
        typeof candidate.paneId === "string" &&
        /^%\d+$/u.test(candidate.paneId) &&
        boundedString(candidate.runtimeId, 256, false) &&
        boundedString(candidate.cwd, 4096, false) &&
        isAgentPaneState(candidate.state) &&
        Number.isSafeInteger(candidate.seq) &&
        (candidate.seq ?? -1) >= 0 &&
        typeof candidate.heartbeatAt === "number" &&
        Number.isFinite(candidate.heartbeatAt) &&
        candidate.heartbeatAt >= 0 &&
        optionalString(candidate.sessionId, 256) &&
        optionalString(candidate.title, 4096) &&
        optionalString(candidate.role, 256) &&
        optionalString(candidate.group, 256) &&
        (candidate.parentPaneId === undefined || /^%\d+$/u.test(candidate.parentPaneId))
    );
}

export function applyReport(
    records: ReadonlyMap<string, AgentPaneRecord>,
    report: AgentPaneRecord,
): Map<string, AgentPaneRecord> {
    const next = new Map(records);
    const current = next.get(report.paneId);
    if (
        current?.runtimeId === report.runtimeId &&
        (report.seq < current.seq ||
            (report.seq === current.seq && report.heartbeatAt <= current.heartbeatAt))
    ) {
        return next;
    }
    if (
        current?.runtimeId !== report.runtimeId &&
        (current?.heartbeatAt ?? -Infinity) > report.heartbeatAt
    ) {
        return next;
    }
    next.set(report.paneId, report);
    return next;
}

export function releaseRecord(
    records: ReadonlyMap<string, AgentPaneRecord>,
    paneId: string,
    runtimeId: string,
): Map<string, AgentPaneRecord> {
    const next = new Map(records);
    if (next.get(paneId)?.runtimeId === runtimeId) next.delete(paneId);
    return next;
}

export function pruneRecords(
    records: Iterable<AgentPaneRecord>,
    now: number,
    staleAfter: number,
    livePaneIds?: ReadonlySet<string>,
): AgentPaneRecord[] {
    return [...records].filter(
        (record) =>
            now - record.heartbeatAt <= staleAfter &&
            (livePaneIds === undefined || livePaneIds.has(record.paneId)),
    );
}

function cwdBasename(cwd: string): string {
    const parts = cwd.replace(/[\\/]+$/u, "").split(/[\\/]/u);
    return parts.at(-1) ?? cwd;
}

export function sortByAttention(records: Iterable<AgentPaneRecord>): AgentPaneRecord[] {
    return [...records].sort(
        (left, right) =>
            STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state] ||
            cwdBasename(left.cwd).localeCompare(cwdBasename(right.cwd)) ||
            left.paneId.localeCompare(right.paneId, undefined, { numeric: true }),
    );
}

export function formatSessionSummary(records: Iterable<AgentPaneRecord>): string {
    const counts: Record<AgentPaneState, number> = {
        idle: 0,
        working: 0,
        "needs-input": 0,
        "needs-permission": 0,
    };
    let total = 0;
    for (const record of records) {
        total += 1;
        counts[record.state] += 1;
    }
    return `π total ${total} · !${counts["needs-permission"]} · ?${counts["needs-input"]} · ▶${counts.working}`;
}
