---
description: "skills: exposes only the named skill through pi's resource loader."
skills: probe-skill
expect_tools_present: "read"
expect_prompt_contains: "probe-skill"
expect_prompt_absent: "SKILL_BODY_MARKER"
---

A named-skill agent. Pi advertises the selected skill's location and loads its
instructions only when invoked.
