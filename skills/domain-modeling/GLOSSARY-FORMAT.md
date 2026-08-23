# GLOSSARY.md Format

## Structure

```md
# {Context Name}

{One or two sentences describing this context and why it exists.}

## Language

**Order**:
{A one or two sentence definition}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## Rules

1. One canonical term per concept. When two terms compete, make one canonical and
   list every competing term under `_Avoid_`.
2. A definition is one or two sentences. State what the concept is, not what its
   implementation does.
3. Include a term only when it is specific to the project's domain. Exclude
   general programming concepts.
4. Group terms under a subheading only when the group contains two or more terms
   that share a concept the other groups do not.

## Single and multiple contexts

1. If `GLOSSARY-MAP.md` exists, follow it to the applicable context.
2. Otherwise use one `GLOSSARY.md` at the repository root.
3. When no `GLOSSARY.md` exists, create the root `GLOSSARY.md` at the moment the
   first domain term is resolved.
4. If two contexts have a claim on a term, ask which context applies.
