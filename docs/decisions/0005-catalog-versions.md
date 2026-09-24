# 0005. Versions only through the catalog

## Context

With versions written inline in each `package.json`, packages drift onto different versions of the same dependency, and
an update means editing many files.

## Decision

- External versions live in `pnpm-workspace.yaml` under `catalog:`; a tool the apps need at another version goes into a
  named catalog under `catalogs:`.
- A `package.json` declares `catalog:`, `catalog:<name>` or `workspace:*` in every dependency field, peers included.
- `pnpm check:catalog` checks it; lefthook runs it when a `package.json` is staged.

## Consequences

- One version per dependency across the repo; an update is one line.
- Adding a dependency means adding it to the catalog first.
