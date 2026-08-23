import { describe, expect, it } from "vitest";

import {
    applyPermissionGuidance,
    formatPermissionGuidance,
    PERMISSION_GUIDANCE_START,
} from "./permission-guidance.ts";
import { resolvePermissionPolicy } from "./permissions.ts";

const allBashExamples = {
    read: true,
    gitAdd: true,
    gitRestoreStaged: true,
    checks: true,
};

describe("permission guidance", () => {
    it("formats auto mode as five concise bullets", () => {
        const guidance = formatPermissionGuidance({
            policy: resolvePermissionPolicy({ mode: "auto" }),
            activeTools: new Set(["bash", "read", "grep", "edit"]),
            configuredBashRestrictions: false,
            bashExamples: allBashExamples,
        });

        expect(guidance).toContain("In auto permission mode");
        expect(guidance).toContain("`git restore --staged <paths>`");
        expect(guidance).toContain("Network writes need approval.");
        expect(guidance).toContain("After a hard denial, stop pursuing that operation.");
        expect(guidance.match(/^- /gmu)).toHaveLength(5);
    });

    it("reflects effect overrides and child policy", () => {
        const guidance = formatPermissionGuidance({
            policy: resolvePermissionPolicy({ mode: "auto", effects: { write: "ask" } }),
            activeTools: new Set(["bash", "write"]),
            configuredBashRestrictions: true,
            bashExamples: { ...allBashExamples, gitAdd: false, gitRestoreStaged: false },
            subagentPolicy: "deny",
        });

        expect(guidance).toContain("Project writes");
        expect(guidance).toContain("need approval");
        expect(guidance).toContain("This child cannot run state-changing");
        expect(guidance).toContain("Configured Bash restrictions still apply.");
        expect(guidance).not.toContain("git add");
        expect(guidance).not.toContain("dedicated edit and write tools");
    });

    it("describes parent approval for prompt-policy children", () => {
        const guidance = formatPermissionGuidance({
            policy: resolvePermissionPolicy({ mode: "guarded" }),
            activeTools: new Set(["bash"]),
            configuredBashRestrictions: false,
            bashExamples: { ...allBashExamples, gitAdd: false, gitRestoreStaged: false },
            subagentPolicy: "prompt",
        });

        expect(guidance).toContain("This child sends required Bash approvals to its parent.");
    });

    it("uses the bypass name without claiming safety is disabled", () => {
        const guidance = formatPermissionGuidance({
            policy: resolvePermissionPolicy({ mode: "bypass" }),
            activeTools: new Set(),
            configuredBashRestrictions: false,
            bashExamples: { read: false, gitAdd: false, gitRestoreStaged: false, checks: false },
        });

        expect(guidance).toContain("In bypass (yolo) permission mode");
        expect(guidance).toContain("Credential operations and privileged operations are denied");
        expect(guidance).not.toContain("git diff");
    });

    it("replaces its prior prompt block", () => {
        const first = applyPermissionGuidance(
            "base",
            `${PERMISSION_GUIDANCE_START}\nold\n</pi-dev-config-permissions>`,
        );
        const second = applyPermissionGuidance(
            first,
            `${PERMISSION_GUIDANCE_START}\nnew\n</pi-dev-config-permissions>`,
        );

        expect(second).toBe(
            "base\n\n<pi-dev-config-permissions>\nnew\n</pi-dev-config-permissions>",
        );
    });
});
