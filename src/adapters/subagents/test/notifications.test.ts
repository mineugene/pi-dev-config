import { describe, expect, test, vi } from "vitest";

import { registerNotificationRenderer } from "../notifications.ts";

describe("registerNotificationRenderer", () => {
    test("pads a two-column status icon before the completion text", () => {
        const pi = { registerMessageRenderer: vi.fn() };
        registerNotificationRenderer(pi as never);

        const renderer = pi.registerMessageRenderer.mock.calls[0]?.[1];
        const component = renderer(
            {
                details: {
                    id: "agent-1",
                    description: "Audit Bash plan coverage",
                    status: "completed",
                    toolUses: 0,
                    turnCount: 0,
                    totalTokens: 0,
                    durationMs: 0,
                    resultPreview: "Done",
                },
            },
            { expanded: false },
            { fg: (_colour: string, text: string) => text, bold: (text: string) => text },
        );

        expect(component?.render(120)[0]?.trimEnd()).toBe(
            " \uf058  Audit Bash plan coverage completed",
        );
    });
});
