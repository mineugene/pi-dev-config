/**
 * Feature registry: the single source of truth for what ships and where it runs.
 *
 * `index.ts` iterates this to register everything; `EXTENSION_NAMES` (the valid
 * `disable` values) is derived from it. Order matters within a tier and is
 * preserved on registration: secretGuard first so its gate runs ahead of other
 * tool_call handlers, bashGate before rtk so approval sees the command the model
 * wrote, paste before vim (they share the editor slot). Each entry adapts a
 * feature's own register signature, so adding a feature is one line here plus its
 * files — no change to index.ts or the config loader.
 */

import registerAtMentionContext from "./at-mention-context/index.ts";
import registerBashGate from "./bash-gate/index.ts";
import registerCaveman from "./caveman.ts";
import registerCheckpoints from "./checkpoints.ts";
import registerCommitSign from "./commit-sign.ts";
import registerCommit from "./commit-tool.ts";
import registerContextAudit from "./context-audit.ts";
import registerEffort from "./effort.ts";
import type { Feature } from "./feature.ts";
import registerFileMention from "./file-mention.ts";
import registerGraphify from "./graphify.ts";
import registerHelp from "./help.ts";
import registerInlineReferences from "./inline-references/index.ts";
import registerLazyTools from "./lazy-tools.ts";
import registerNotifications from "./notifications.ts";
import registerPaste from "./paste.ts";
import registerPonytail from "./ponytail.ts";
import registerPrGuard from "./pr-guard.ts";
import registerPromptNormalization from "./prompt-normalization.ts";
import registerPromptSlim from "./prompt-slim.ts";
import { registerAskUserQuestionTool } from "./question/ask-user-question.ts";
import registerRead from "./read.ts";
import registerRouting from "./routing.ts";
import registerRtk from "./rtk.ts";
import registerSearch from "./search.ts";
import registerSecretGuard from "./secret-guard.ts";
import registerSessionTracker from "./session-tracker.ts";
import registerStatusline from "./statusline.ts";
import registerSubagents from "./subagents/index.ts";
import registerTimer from "./timer.ts";
import registerTodo from "./todo.ts";
import registerTokenCount from "./token-count/index.ts";
import registerUsageDashboard from "./usage-dashboard.ts";
import registerVim from "./vim.ts";
import registerWeb from "./web/index.ts";
import registerWorkingIndicator from "./working-indicator.ts";

export const FEATURES: readonly Feature[] = [
    // core: child-safe functionality for every mode, including `-p` and subagents.
    {
        name: "secretGuard",
        tier: "core",
        register: (pi, ctx) => registerSecretGuard(pi, ctx.config),
    },
    { name: "read", tier: "core", register: (pi, ctx) => registerRead(pi, ctx.config) },
    { name: "search", tier: "core", register: (pi) => registerSearch(pi) },
    { name: "web", tier: "core", register: (pi, ctx) => registerWeb(pi, ctx.config) },
    { name: "prGuard", tier: "core", register: (pi) => registerPrGuard(pi) },
    { name: "bashGate", tier: "core", register: (pi, ctx) => registerBashGate(pi, ctx.config) },
    { name: "rtk", tier: "core", register: (pi) => registerRtk(pi) },
    {
        name: "graphify",
        tier: "core",
        register: (pi, ctx) => registerGraphify(pi, ctx.config),
    },
    {
        name: "promptSlim",
        tier: "core",
        register: (pi, ctx) => registerPromptSlim(pi, ctx.config),
    },

    // session: full sessions only (not subagent children); still headless-safe.
    { name: "todo", tier: "session", register: (pi) => registerTodo(pi) },
    { name: "caveman", tier: "session", register: (pi) => registerCaveman(pi) },
    { name: "ponytail", tier: "session", register: (pi) => registerPonytail(pi) },
    { name: "help", tier: "session", register: (pi) => registerHelp(pi) },
    {
        name: "commitSign",
        tier: "session",
        register: (pi, ctx) => registerCommitSign(pi, ctx.config),
    },
    { name: "commit", tier: "session", register: (pi) => registerCommit(pi) },
    {
        name: "checkpoints",
        tier: "session",
        register: (pi, ctx) => registerCheckpoints(pi, ctx.config),
    },
    {
        name: "promptNormalization",
        tier: "session",
        register: (pi) => registerPromptNormalization(pi),
    },
    { name: "atMentionContext", tier: "session", register: (pi) => registerAtMentionContext(pi) },
    { name: "inlineReferences", tier: "session", register: (pi) => registerInlineReferences(pi) },
    {
        name: "routing",
        tier: "session",
        register: (pi, ctx) => registerRouting(pi, ctx.config),
    },
    {
        name: "sessionTracker",
        tier: "session",
        register: (pi, ctx) => registerSessionTracker(pi, { configRef: ctx.config }),
    },

    // interactive: UI features; skipped under `-p` / `--print`.
    {
        name: "subagents",
        tier: "interactive",
        register: (pi, ctx) => registerSubagents(pi, ctx.config),
    },
    { name: "question", tier: "interactive", register: (pi) => registerAskUserQuestionTool(pi) },
    { name: "effort", tier: "interactive", register: (pi) => registerEffort(pi) },
    {
        name: "timer",
        tier: "interactive",
        register: (pi, ctx) => registerTimer(pi, ctx.config),
    },
    {
        name: "workingIndicator",
        tier: "interactive",
        register: (pi) => registerWorkingIndicator(pi),
    },
    {
        name: "notifications",
        tier: "interactive",
        register: (pi, ctx) => registerNotifications(pi, ctx.config),
    },
    { name: "tokenCount", tier: "interactive", register: (pi) => registerTokenCount(pi) },
    { name: "usageDashboard", tier: "interactive", register: (pi) => registerUsageDashboard(pi) },
    { name: "fileMention", tier: "interactive", register: (pi) => registerFileMention(pi) },
    {
        name: "statusline",
        tier: "interactive",
        register: (pi, ctx) => registerStatusline(pi, ctx.config),
    },
    {
        name: "paste",
        tier: "interactive",
        register: (pi, ctx) =>
            registerPaste(
                pi,
                () => ctx.isFeatureEnabled("vim") && ctx.config.current.vim?.enabled === true,
            ),
    },
    { name: "vim", tier: "interactive", register: (pi, ctx) => registerVim(pi, ctx.config) },
    // Must run after optional foreground tools so it can deactivate their schemas once.
    { name: "lazyTools", tier: "session", register: (pi) => registerLazyTools(pi) },
    // Observes the fully chained foreground prompt for /context-audit.
    { name: "contextAudit", tier: "session", register: (pi) => registerContextAudit(pi) },
];

/** Valid `disable` values, derived from the registry so the two never drift. */
export const EXTENSION_NAMES: readonly string[] = FEATURES.map((feature) => feature.name);
