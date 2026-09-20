# `@novastarter/types`

Shared types for Novastarter.

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
