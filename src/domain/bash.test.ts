import { describe, expect, test } from "vitest";

import {
    analyzeBashFacts,
    authorizeBashFacts,
    type BashFacts,
    type BashPolicy,
    bashGuardDecision,
    DEFAULT_BASH_ALLOW_RULES,
    DEFAULT_BASH_PROTECTED_RULES,
} from "./bash.ts";

function facts(...commands: string[][]): BashFacts {
    return {
        text: commands.map((argv) => argv.join(" ")).join(" && "),
        commands: commands.map((argv) => ({
            ...(argv[0] === undefined ? {} : { name: argv[0] }),
            ...(argv[1] === undefined ? {} : { subcommand: argv[1] }),
            argv,
            flags: argv.filter((arg, index) => index > 0 && arg.startsWith("-")),
        })),
        redirects: [],
        pathCandidates: [],
        constructs: [],
        hasPipe: false,
        hasParseError: false,
    };
}

const policy: BashPolicy = {
    protectedRules: DEFAULT_BASH_PROTECTED_RULES,
    configuredProtectedRules: [],
    allowRules: DEFAULT_BASH_ALLOW_RULES,
};

describe("analyzeBashFacts", () => {
    test.each([
        [
            ["git", "status"],
            ["read", "process"],
        ],
        [
            ["git", "diff"],
            ["read", "process"],
        ],
        [
            ["npm", "test"],
            ["read", "process"],
        ],
        [
            ["cargo", "check"],
            ["write", "process"],
        ],
        [
            ["go", "build"],
            ["write", "process"],
        ],
        [
            ["dotnet", "build", "--no-restore", "-v:minimal"],
            ["write", "process"],
        ],
        [
            ["dotnet", "test", "--no-restore"],
            ["write", "process"],
        ],
        [["tsc"], ["write", "process"]],
        [
            ["npm", "run", "build"],
            ["write", "process"],
        ],
        [
            ["graphify", "update", "."],
            ["write", "process"],
        ],
        [
            ["graphify", "cluster-only", ".", "--no-label"],
            ["write", "process"],
        ],
        [
            ["gh", "pr", "view", "42"],
            ["network", "process"],
        ],
        [
            ["kubectl", "get", "pods"],
            ["network", "process"],
        ],
        [
            ["rm", "file"],
            ["delete", "process"],
        ],
        [
            ["git", "add", "file"],
            ["write", "process"],
        ],
        [
            ["sd", "old", "new", "src/foo.ts"],
            ["write", "process"],
        ],
        [
            ["git", "push", "origin", "main"],
            ["network", "write", "process"],
        ],
        [
            ["curl", "https://example.com"],
            ["network", "process"],
        ],
        [
            ["curl", "-X", "POST", "https://example.com"],
            ["network", "write", "process"],
        ],
        [
            ["sudo", "true"],
            ["privileged", "process"],
        ],
    ])("derives normalized effects for %j", (argv, effects) => {
        expect(analyzeBashFacts(facts(argv))).toEqual({
            effects: new Set(effects),
            unknown: false,
        });
    });

    test("derives write and process effects from output redirection", () => {
        expect(
            analyzeBashFacts({
                ...facts(["echo", "foo"]),
                redirects: [{ operator: ">", target: "file" }],
            }),
        ).toEqual({ effects: new Set(["process", "write"]), unknown: false });
    });

    test("marks unclassified executables as unknown", () => {
        expect(analyzeBashFacts(facts(["acme", "deploy"]))).toEqual({
            effects: new Set(["process"]),
            unknown: true,
        });
    });

    test("uses existing protected rules to refine effects and ambiguity", () => {
        expect(analyzeBashFacts(facts(["ruff", "check", "--fix"]))).toEqual({
            effects: new Set(["read", "process", "write"]),
            unknown: false,
        });
        expect(analyzeBashFacts(facts(["fd", "--exec", "rm", "{}"]))).toEqual({
            effects: new Set(["read", "process"]),
            unknown: true,
        });
        expect(analyzeBashFacts(facts(["git", "reset", "--hard"]))).toEqual({
            effects: new Set(["write", "process"]),
            unknown: true,
        });
    });
});

describe("bashGuardDecision", () => {
    test.each([
        ["rm", "-rf", "/"],
        ["rm", "-rf", "/*"],
        ["dd", "if=/dev/zero", "of=/dev/sda"],
        ["mkfs.ext4", "/dev/sda"],
    ])("denies a catastrophic command: %j", (...argv) => {
        expect(bashGuardDecision(facts(argv), [])).toBe("deny");
    });

    test("keeps dynamic shell execution approval-gated", () => {
        expect(bashGuardDecision(facts(["bash", "-c", "rm -rf /"]), [])).toBe("ask");
    });
});

describe("authorizeBashFacts", () => {
    test("gives every built-in protected rule a unique stable ID", () => {
        const ids = DEFAULT_BASH_PROTECTED_RULES.map((rule) => rule.id);

        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(DEFAULT_BASH_PROTECTED_RULES.every((rule) => Boolean(rule.reason))).toBe(true);
        expect(
            [...DEFAULT_BASH_PROTECTED_RULES, ...DEFAULT_BASH_ALLOW_RULES].every(
                (rule) => (rule.effects?.length ?? 0) > 0,
            ),
        ).toBe(true);
    });

    test("allows routine commands", () => {
        for (const command of [
            ["git", "status"],
            ["rg", "needle", "."],
            ["fd", "-e", "ts"],
            ["sd", "old", "new", "src/foo.ts"],
        ]) {
            expect(authorizeBashFacts(facts(command), policy)).toMatchObject({
                decision: "allow",
                source: "allowlist",
            });
        }
    });

    test("allows plain find and protects search command execution", () => {
        expect(authorizeBashFacts(facts(["find", ".", "-name", "*.ts"]), policy)).toMatchObject({
            decision: "allow",
            source: "allowlist",
        });
        for (const flag of ["-exec", "-execdir", "-ok", "-okdir"]) {
            expect(
                authorizeBashFacts(facts(["find", ".", flag, "rm", "{}", ";"]), policy),
            ).toMatchObject({
                decision: "prompt",
                source: "protected",
            });
        }
        for (const flag of ["-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]) {
            expect(authorizeBashFacts(facts(["find", ".", flag]), policy)).toMatchObject({
                decision: "prompt",
                source: "protected",
            });
        }
        for (const flag of ["-x", "--exec", "-X", "--exec-batch"]) {
            expect(authorizeBashFacts(facts(["fd", flag, "rm", "{}"]), policy)).toMatchObject({
                decision: "prompt",
                source: "protected",
            });
        }
        for (const flag of ["--pre=rm", "--hostname-bin=rm"]) {
            expect(authorizeBashFacts(facts(["rg", flag, "needle", "."]), policy)).toMatchObject({
                decision: "prompt",
                source: "protected",
            });
        }
    });

    test("prompts for protected commands before checking the allowlist", () => {
        const result = authorizeBashFacts(facts(["find", ".", "-delete"]), policy);

        expect(result).toMatchObject({ decision: "prompt", source: "protected" });
        expect(result.matched.map((match) => match.permissionId)).toContain("find.delete");
    });

    test("prompts for unknown commands with an intent-based session scope", () => {
        expect(authorizeBashFacts(facts(["acme", "deploy", "preview"]), policy)).toEqual({
            decision: "prompt",
            source: "unknown",
            matched: [],
            reasons: ["This command is not in the routine command allowlist."],
            scope: { kind: "unknown", ids: ["command.unknown:acme:deploy"] },
        });
    });

    test("allows a compound expression only when every command is allowlisted", () => {
        expect(authorizeBashFacts(facts(["git", "status"], ["pytest"]), policy).decision).toBe(
            "allow",
        );
        expect(
            authorizeBashFacts(facts(["git", "status"], ["unknown-tool"]), policy),
        ).toMatchObject({ decision: "prompt", source: "unknown" });
    });

    test("protects write redirects and shell substitutions", () => {
        const withRedirect = {
            ...facts(["echo", "foo"]),
            redirects: [{ operator: ">", target: "result.txt" }],
        };
        const withSubstitution = {
            ...facts(["echo", "foo"], ["pwd"]),
            text: "echo $(pwd)",
            constructs: ["command-substitution" as const],
        };

        expect(authorizeBashFacts(withRedirect, policy)).toMatchObject({
            decision: "prompt",
            source: "protected",
        });
        const substitution = authorizeBashFacts(withSubstitution, policy);
        expect(substitution).toMatchObject({ decision: "prompt", source: "protected" });
        expect(substitution.decision === "prompt" && substitution.scope.ids[0]).toContain(
            "shell.command-substitution",
        );
    });

    test("treats parser errors as unknown instead of allowing partial facts", () => {
        expect(
            authorizeBashFacts({ ...facts(["echo", "foo"]), hasParseError: true }, policy),
        ).toMatchObject({ decision: "prompt", source: "unknown" });
    });

    test("configured protection overrides an allow rule and gets a namespaced scope", () => {
        const configuredPolicy = {
            ...policy,
            configuredProtectedRules: [
                { id: "project.pytest", cmd: "pytest", reason: "Runs a protected project check." },
            ],
        };
        const result = authorizeBashFacts(facts(["pytest"]), configuredPolicy);

        expect(result).toMatchObject({
            decision: "prompt",
            source: "protected",
            matched: [{ source: "configured" }],
        });
        expect(result.matched[0]?.permissionId).toContain("configured:project.pytest:");
    });

    test("keeps configured permission scopes stable across wording changes", () => {
        const classify = (reason: string) =>
            authorizeBashFacts(facts(["acme", "deploy"]), {
                ...policy,
                configuredProtectedRules: [{ cmd: "acme", subcommands: "deploy", reason }],
            });
        const first = classify("Changes the service.");
        const second = classify("Deploys the service.");

        expect(first).toMatchObject({ decision: "prompt", source: "protected" });
        expect(first.decision === "prompt" && first.scope).toEqual(
            second.decision === "prompt" && second.scope,
        );
    });

    test("keeps unknown compound parts in a protected permission scope", () => {
        const result = authorizeBashFacts(facts(["rm", "one"], ["acme", "deploy"]), policy);

        expect(result).toMatchObject({
            decision: "prompt",
            source: "protected",
            scope: {
                ids: ["command.unknown:acme:deploy", "filesystem.delete.rm"],
            },
        });
    });

    test("uses narrow stable scopes for different Git operations", () => {
        const reset = authorizeBashFacts(facts(["git", "reset", "--hard"]), policy);
        const checkout = authorizeBashFacts(facts(["git", "checkout", "other"]), policy);

        expect(reset.decision === "prompt" && reset.scope.ids[0]).toContain("git.local.reset");
        expect(checkout.decision === "prompt" && checkout.scope.ids[0]).toContain(
            "git.local.checkout",
        );
        expect(reset.decision === "prompt" && reset.scope).not.toEqual(
            checkout.decision === "prompt" && checkout.scope,
        );
    });
});
