# `@novastarter/types`

Shared types for Novastarter.

## Description

Type-only package: the definitions several packages and apps agree on, grouped by the subsystem they describe and
re-exported from the package root. It has no runtime code, so it belongs in `devDependencies` unless a package's own
declarations reference it.

- `NovastarterError` — the shape of every error made with `createError()` of `@novastarter/errors`;
- `EventContext`, `FilterHandler`, `ActionHandler`, `InitHandler` — what `@novastarter/emitter` hands to hooks;
- `Filter`, `FieldFilter`, `LogicalFilter` and the operator unions — the filter rules `@novastarter/validation` checks;
- `Range`, `Stat`, `ReadOptions`, `ChunkedUploadContext` — what a `@novastarter/storage` driver reads and reports.

## Installation

```
pnpm add -D @novastarter/types
```

## Usage

```ts
import type { Filter, NovastarterError, Stat } from '@novastarter/types';

const rules: Filter = { _and: [{ age: { _gte: 18 } }] };

const describe = (error: NovastarterError, stat: Stat): string => `${error.code} while reading ${stat.size} bytes`;
```
