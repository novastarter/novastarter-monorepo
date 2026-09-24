# 0003. Next.js and React only

## Context

Some tooling was ported from projects built on Vue, and brought Vue-specific dependencies and lint plugins with it
(`eslint-plugin-vue` and the like).

## Decision

The apps are Next.js with React. No Vue dependencies, plugins or configs anywhere in the repo; strip them when porting
tooling.

## Consequences

- One UI stack to lint, type and build.
- Ported code needs a pass to remove what belongs to another framework.
