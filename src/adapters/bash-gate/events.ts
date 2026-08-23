import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type BashGateDecision = "allow" | "allow-session" | "deny";

export interface ApprovalRequest {
    requestId: string;
    agentId?: string;
    title: string;
    command: string;
    source: "protected" | "unknown";
    permissionIds: string[];
    reasons: string[];
}

export function formatPermissionPrompt(
    command: string,
    reasons: readonly string[],
    requester?: string,
): string {
    return [
        "Permission required",
        "",
        ...(requester ? [`${requester} requests permission to run:`, ""] : []),
        ...command.split("\n").map((line, index) => (index === 0 ? `$ ${line}` : `  ${line}`)),
        "",
        ...reasons,
    ].join("\n");
}

export async function requestSubagentApproval(
    pi: ExtensionAPI,
    request: Omit<ApprovalRequest, "requestId">,
): Promise<BashGateDecision> {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const channel = "subagents:bash_gate:approval";
    const ackChannel = `${channel}:ack:${requestId}`;
    const replyChannel = `${channel}:reply:${requestId}`;

    return await new Promise<BashGateDecision>((resolve) => {
        let settled = false;
        let acked = false;
        let unsubAck = () => {};
        let unsubReply = () => {};
        const settle = (decision: BashGateDecision) => {
            if (settled) return;
            settled = true;
            clearTimeout(ackTimer);
            unsubAck();
            unsubReply();
            resolve(decision);
        };

        unsubAck = pi.events.on(ackChannel, () => {
            acked = true;
        });
        unsubReply = pi.events.on(replyChannel, (reply) => {
            if (typeof reply !== "object" || reply === null || !("decision" in reply)) {
                settle("deny");
                return;
            }
            const { decision } = reply;
            settle(decision === "allow" || decision === "allow-session" ? decision : "deny");
        });

        const ackTimer = setTimeout(() => {
            if (!acked) settle("deny");
        }, 250);

        pi.events.emit(channel, { requestId, ...request });
    });
}

export function onSubagentApprovalRequest(
    pi: ExtensionAPI,
    handler: (request: ApprovalRequest) => Promise<BashGateDecision>,
): () => void {
    return pi.events.on("subagents:bash_gate:approval", async (data) => {
        const request = data as ApprovalRequest;
        const channel = "subagents:bash_gate:approval";
        pi.events.emit(`${channel}:ack:${request.requestId}`, {});
        let decision: BashGateDecision = "deny";
        try {
            decision = await handler(request);
        } finally {
            pi.events.emit(`${channel}:reply:${request.requestId}`, { decision });
        }
    });
}
