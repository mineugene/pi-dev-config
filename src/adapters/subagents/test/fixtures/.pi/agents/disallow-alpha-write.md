---
description: "Loads alpha and beta but denylists alpha_write."
extensions: "./ext-alpha.mjs, ./ext-beta.mjs"
disallowed_tools: "alpha_write"
expect_tools_present: "read, alpha_read, beta_tool"
expect_tools_absent: "alpha_write"
---

e2e template: disallowed_tools removes an extension tool after loading.
