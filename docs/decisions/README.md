# Decisions

Short notes on decisions that shape the code: what was decided and why. Read them before proposing a change to
structure, configuration or exports. A new decision gets the next number; a reversed one stays, marked as superseded,
with a link to the note that replaces it.

| #    | Decision                                                                   |
| ---- | -------------------------------------------------------------------------- |
| 0001 | [Apps register managers explicitly](0001-explicit-manager-registration.md) |
| 0002 | [Packages do not read the environment](0002-no-env-in-packages.md)         |
| 0003 | [Next.js and React only](0003-next-react-only.md)                          |
| 0004 | [Named exports only](0004-named-exports-only.md)                           |
| 0005 | [Versions only through the catalog](0005-catalog-versions.md)              |
| 0006 | [Comments explain why, not what](0006-comments-explain-why.md)             |
| 0007 | [Configuration errors are `InvalidConfigError`](0007-config-errors.md)     |

## Template

```md
# NNNN. Title

## Context

What problem or force led to the decision. A few sentences.

## Decision

What was decided, stated as a rule.

## Consequences

What follows: what gets easier, what gets harder, what is now forbidden.
```
