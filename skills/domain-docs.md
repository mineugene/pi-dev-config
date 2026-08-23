# Domain docs

Where this project's glossary and ADRs live, and how to read them. This file is
the single source for both. `domain-modeling` owns the files; every other skill
only reads them.

## Locations

- The glossary is `GLOSSARY.md` at the repository root. When a root
  `GLOSSARY-MAP.md` exists, follow it to the topic's context glossary and ADR
  directory.
- Architectural decision records live in root `docs/adr/` for system-wide
  decisions. When `GLOSSARY-MAP.md` exists, context-scoped decisions also live
  in `src/<context>/docs/adr/`.

## Reading rules

1. Read the `GLOSSARY.md` that covers the topic. When `GLOSSARY-MAP.md` exists,
   follow it first.
2. Read every architectural decision record that touches the area.
3. When a glossary or ADR directory is absent, proceed silently. Do not flag the
   absence and do not create the files. `domain-modeling` creates them lazily.
4. Use the glossary's terms exactly. Do not substitute a term it marks `_Avoid_`.
5. When an output contradicts an ADR, state the conflict and explain why the
   decision may warrant revisiting.

## Layout

Single context, most repositories:

```text
/
|-- GLOSSARY.md
|-- docs/adr/
|   |-- 0001-event-sourced-orders.md
|   `-- 0002-postgres-for-write-model.md
`-- src/
```

Multiple contexts, a root `GLOSSARY-MAP.md` exists:

```text
/
|-- GLOSSARY-MAP.md
|-- docs/adr/                 system-wide decisions
`-- src/
    |-- ordering/
    |   |-- GLOSSARY.md
    |   `-- docs/adr/         context-specific decisions
    `-- billing/
        |-- GLOSSARY.md
        `-- docs/adr/
```
