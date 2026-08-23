---
name: ponytail-gain
disable-model-invocation: true
description: >
  Show ponytail's measured impact as a compact scoreboard: less code, less
  cost, more speed, from the benchmark medians. One-shot display, not a
  persistent mode, and not a per-repo number. Trigger: "ponytail gain",
  "what does ponytail save", "show ponytail impact", "ponytail scoreboard".
---
# Ponytail Gain

Display this scoreboard. One-shot: do not change mode, write flag files, or
persist anything.

The figures are published benchmark medians over 5 tasks (email validator,
debounce, CSV sum, countdown timer, rate limiter) and 3 models (Haiku, Sonnet,
Opus), measured from `benchmarks/` and the README. They are not computed from
the current repository.

## Scoreboard

Render plain ASCII bars. The bar length shows the measured range; the label
carries the exact figure:

```
  ponytail gain                     benchmark median - 5 tasks - 3 models

  Lines of code   no-skill  ████████████████████  100%
                  ponytail  ██▌·················    6-20%   ▼ 80-94%
  Cost            no-skill  ████████████████████  100%
                  ponytail  █████▌··············   23-53%  ▼ 47-77%
  Speed           ponytail  ▸ 3-6× faster

  This repo:  $skill:ponytail-debt  (shortcuts you deferred)
              $skill:ponytail-audit (what's still cuttable)
```

## Honesty boundary

Do not print a per-repository savings number. The unbuilt version was never
written, so no real baseline exists in a live repository. The only real
per-repository figure is the counted ledger from `$skill:ponytail-debt`; point
there instead.

## Exclusions

One-shot display. Edit nothing. Do not change the Ponytail runtime mode.
