# CONTEXT.md Format

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

- Pick one canonical term when synonyms compete and list the others under
  `_Avoid_`.
- Keep definitions to one or two sentences. Define what a concept is, not what
  its implementation does.
- Include only terms specific to the project's domain. Exclude general
  programming concepts.
- Group terms under subheadings only when natural clusters emerge.

## Single and multiple contexts

Most repositories use one `CONTEXT.md` at the root. If `CONTEXT-MAP.md` exists,
follow it to the relevant context. When neither exists, create a root `CONTEXT.md`
lazily when the first domain term is resolved. If several contexts could own a
term, ask which one applies.
