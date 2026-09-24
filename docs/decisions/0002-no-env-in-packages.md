# 0002. Packages do not read the environment

## Context

A package that reads `process.env` hides its configuration, ties itself to one app's variable names and cannot be given
two configurations in one process.

## Decision

- Packages take configuration as arguments (constructor options, location configs).
- `@novastarter/env` is the only package that reads `process.env`: reading it is its job. The app parses its variables
  through it once and hands the values on.
- Exceptions: `release-notes-generator` (a CLI, reading its environment is its job) and `*.int.test.ts` (a test skips
  without the address of its service).
- ESLint (`no-restricted-properties`) enforces it in `packages/`.

## Consequences

- The app owns every variable name; packages stay reusable across apps.
- Tests pass options directly instead of patching the environment.
