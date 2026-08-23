---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.
---
# Diagnosing Bugs

Run the phases in order. Skip a phase only when the user explicitly approves the
skip.

When exploring the codebase, follow [domain-docs.md](../domain-docs.md) to find
the glossary and architectural decision records.

## Redaction

Replace each secret with `<REDACTED>` before showing a command, output, or
captured artifact to the user. Build loops against environment variables so
credentials stay in the environment. Quote only the lines of a captured artifact
that carry the diagnostic signal.

If the redacted output is insufficient to diagnose the bug, state that and ask
the user.

## Phase 1: Build a feedback loop

Completion requires one command that satisfies every check:

- [ ] Drives the bug's code path.
- [ ] Asserts the user's exact symptom.
- [ ] Ran at least once already; show the invocation and its redacted output.
- [ ] Is red-capable: it goes red on this bug and green once fixed.
- [ ] Is deterministic: the same verdict every run. For a flaky bug, see
      "Non-deterministic bugs".
- [ ] Is fast: seconds, not minutes.
- [ ] Is agent-runnable without a human.

If a human must act, drive them with `scripts/hitl-loop.template.sh`.

Do not begin Phase 2 before this checklist passes.

### Constructing the loop

Attempt in this order:

1. Failing test at a seam that reaches the bug: unit, integration, or e2e.
2. HTTP script against a running dev server.
3. CLI invocation with a fixture input, diffing stdout against a known-good
   snapshot.
4. Headless browser script that drives the UI and asserts on DOM, console, or
   network.
5. Replay of a captured trace saved to disk.
6. Throwaway harness that runs the bug code path with one function call.
7. Property or fuzz loop with many random inputs.
8. Bisection harness usable by `git bisect run`.
9. Differential loop: run the same input through old and new versions, then diff.
10. Human-in-the-loop script from `scripts/hitl-loop.template.sh`.

### Tightening the loop

After a loop exists, apply each:

- Cache setup and skip unrelated initialization to reduce runtime.
- Assert the specific symptom, not absence of a crash.
- Pin time, seed the RNG, isolate the filesystem, and freeze the network.

### Non-deterministic bugs

Replace a reproduction that always triggers with a `reproduction rate`. Loop the trigger at
least 100 times, parallelise, add stress, and narrow timing windows until the
rate is high enough to debug against.

### No loop possible

If no loop can be built:

1. Stop.
2. List every attempt.
3. Ask the user for one of: access to a reproducing environment; a redacted
   captured artifact; or permission to add temporary production instrumentation.
4. Do not begin Phase 2.

## Phase 2: Reproduce and minimise

Run the loop and watch it go red. Confirm all:

- [ ] The failure mode equals the user's described symptom, not a nearby one.
- [ ] The failure reproduces across repeated runs, or at a high enough rate for a
      flaky bug.
- [ ] The exact symptom is captured: error text, wrong output, or timing.

### Minimise

1. Cut one element at a time from inputs, callers, configuration, data, and
   steps.
2. Re-run the loop after each cut.
3. Keep only elements whose removal makes the loop go green.

Stop when every remaining element is load-bearing: removing any one makes the
loop green. Do not begin Phase 3 before this holds.

## Phase 3: Hypothesise

1. Generate 3 to 5 hypotheses before testing any of them.
2. Give each hypothesis a falsifiable prediction:
   `If <X> is the cause, then <change Y> makes the bug disappear, or <change Z>
   makes it worse.`
3. Discard or sharpen any hypothesis with no prediction.
4. Rank the hypotheses and print the ranked list to the user before testing.
5. If the user does not respond, proceed with the ranking.

## Phase 4: Instrument

1. Map each probe to exactly one Phase 3 prediction.
2. Change one variable per probe.
3. Probe tool order:
   1. Debugger or REPL inspection, when the environment supports it.
   2. Targeted logs at the boundaries that distinguish hypotheses.
   3. Never "log everything and grep".
4. Prefix every debug log with a unique tag, for example `[DEBUG-a4f2]`.
5. For a performance regression: establish a baseline measurement first (timing
   harness, `performance.now()`, profiler, or query plan), then bisect. Measure
   first, fix second.

## Phase 5: Fix and regression test

Write the regression test before the fix, only at a correct seam. A correct seam
exercises the real bug pattern as it occurs at the call site.

If no correct seam exists:

1. Record that absence as the finding.
2. Flag the architecture problem in Phase 6.
3. Do not write a regression test at a shallower seam.

If a correct seam exists:

1. Turn the minimised reproduction into a failing test at that seam.
2. Watch it fail. When the red came from a code or fixture mutation, diff the
   mutation against a pristine copy to prove it landed before trusting the red.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 loop against the original, un-minimised scenario.

## Phase 6: Cleanup

Before declaring done, confirm every item:

- [ ] The original reproduction no longer reproduces (re-run the Phase 1 loop).
- [ ] The regression test passes, or the absence of a correct seam is documented.
- [ ] Every `[DEBUG-...]` instrumentation is removed.
- [ ] Throwaway prototypes are deleted or moved to a clearly marked debug
      location.
- [ ] The correct hypothesis is stated in the commit or pull request message.
