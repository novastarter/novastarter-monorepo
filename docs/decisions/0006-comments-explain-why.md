# 0006. Comments explain why, not what

## Context

AGENTS.md used to demand a numbered comment (`// 1.`, `// 2.`) before every logical block of every function. The repo
collected about 6500 of them. Most retold the next line of code ("Create the set", "Return the result"), went stale when
the code changed, and doubled the text an agent had to read without adding facts. The numbers also had to be rewritten
on every inserted step.

## Decision

- A comment inside a function body only says what the code cannot: why it is done this way, a constraint, a non-obvious
  consequence, a link to a protocol or bug.
- No numbering: the step order is visible from the code. ESLint (`local/no-numbered-comments`) rejects a line comment
  that starts with `<digits>.`.
- A comment that retells the code is deleted; in a "what + why" comment only the why stays.
- JSDoc on declarations is unchanged and still checked by `eslint-plugin-jsdoc`.

## Consequences

- Fewer, denser comments; each one that survives carries a fact the code does not.
- Short functions often have no body comments at all, which is fine.
- A numbered list inside a comment has to be written without a leading `N.` on the comment line (use `-` or prose).
