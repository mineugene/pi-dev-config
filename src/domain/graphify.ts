const FAILURE_REASONS = {
    failed: "operation failed; inspect its output",
    incomplete: "extraction was incomplete; fix the reported omissions and retry",
    publication_failed: "graph publication did not complete",
    timeout: "operation timed out",
    interrupted: "operation was interrupted",
    reconciliation_failed: "changed-source reconciliation failed; inspect output before retrying",
} as const;

type GraphOperation = "update" | "extract";

export interface GraphFailure {
    operation: GraphOperation;
    reason: keyof typeof FAILURE_REASONS;
    source: "cli" | "watcher" | "hook";
    at: number;
    log?: string;
}

export interface GraphStatus {
    graphExists: boolean;
    needsUpdate: boolean;
    failures: GraphFailure[];
    signal: "valid" | "legacy" | "unreadable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGraphFailures(value: unknown): GraphFailure[] | undefined {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.failures)) return;
    const failures: GraphFailure[] = [];
    for (const [operation, failure] of Object.entries(value.failures)) {
        if (
            (operation !== "update" && operation !== "extract") ||
            !isRecord(failure) ||
            typeof failure.reason !== "string" ||
            !Object.hasOwn(FAILURE_REASONS, failure.reason) ||
            (failure.source !== "cli" &&
                failure.source !== "watcher" &&
                failure.source !== "hook") ||
            typeof failure.at !== "number" ||
            !Number.isFinite(failure.at) ||
            failure.at < 0
        )
            return;
        const log =
            typeof failure.log === "string" &&
            failure.log.startsWith("/") &&
            !failure.log.startsWith("//") &&
            failure.log.length <= 2048 &&
            !/[\p{Cc}\p{Cf}]/u.test(failure.log)
                ? failure.log
                : undefined;
        failures.push({
            operation,
            reason: failure.reason as GraphFailure["reason"],
            source: failure.source,
            at: failure.at,
            ...(log ? { log } : {}),
        });
    }
    return failures.sort((a, b) => b.at - a.at);
}

export function graphHasFailure(status: GraphStatus): boolean {
    return status.signal === "unreadable" || status.failures.length > 0;
}

export function formatGraphStatus(status: GraphStatus, cwd: string): string {
    const lines = [
        `Project: ${cwd.replace(/[\p{Cc}\p{Cf}]/gu, "")}`,
        `Graph: ${status.graphExists ? "present" : "not built"}`,
        `Semantic update: ${status.needsUpdate ? "pending" : "no marker (not proof of freshness)"}`,
    ];
    if (status.signal === "legacy")
        lines.push(
            "Rebuild-error signal: unavailable; only graph and pending-marker state can be reported.",
        );
    if (status.signal === "unreadable")
        lines.push(
            "Rebuild-error signal: unreadable or unsupported; inspect graphify-out/.graphify_status.json.",
        );
    if (status.signal === "valid" && status.failures.length === 0)
        lines.push("Recorded failures: none");
    for (const failure of status.failures) {
        lines.push(
            `Failure: ${failure.operation} (${failure.source}) - ${FAILURE_REASONS[failure.reason]}`,
        );
        lines.push(
            failure.log
                ? `Log: ${failure.log}`
                : `Details: ${failure.source === "watcher" ? "watcher terminal output" : "command output"}`,
        );
        lines.push(`Retry from the project root: graphify ${failure.operation} .`);
    }
    if (status.needsUpdate || !status.graphExists)
        lines.push(
            "Refresh semantics from the project root: graphify extract . (can use LLM tokens)",
        );
    lines.push("Code-only refresh: graphify update . (no LLM; does not clear pending semantics)");
    return lines.join("\n");
}
