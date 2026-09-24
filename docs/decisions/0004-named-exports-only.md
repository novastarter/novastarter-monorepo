# 0004. Named exports only

## Context

`export * from` barrels and `export default` make code hard to find by grep: a symbol can be exported under a different
name, or through several layers of re-exports, and a default import takes whatever name the importer picks. People and
agents then fail to find the definition or the users of a symbol.

## Decision

- Named exports only. Every `index.ts` lists its names; types go through `export type { … }`.
- No `export *`, no `export default`, no renaming on export (`export { a as b }`).
- Exceptions: Next files under `apps/*/app/**` and `*.config.*`, where the tool demands a default export.
- No dynamic `import()` without an `eslint-disable-next-line` comment giving the reason (an optional peer, a Next
  runtime split).
- ESLint (`no-restricted-syntax`) enforces it.

## Consequences

- One symbol, one name, everywhere: a grep for the name finds the definition, the export and every user.
- Drivers lost their default export: `import { StorageDriverS3 } from '@novastarter/storage-driver-s3'`.
- A new export must be added to the list in `index.ts` by hand.
