---
description: "isolated:true forces built-ins only, overriding extensions."
isolated: true
extensions: "./ext-alpha.mjs, ./ext-beta.mjs"
tools: "*"
expect_tools_present: "read, bash, edit, write, grep, find, ls"
expect_tools_absent: "alpha_read, alpha_write, beta_tool"
---

e2e template: per the README, isolated:true is hermetic — it forces
extensions:false + skills:false, leaving only built-ins even though this template
also sets extensions.
