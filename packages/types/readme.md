# `@novastarter/types`

Shared types for Novastarter.

## Installation

```
pnpm add @novastarter/types
```

## Usage

```ts
import type { Filter, NovastarterError } from '@novastarter/types';

const rules: Filter = { _and: [{ age: { _gte: 18 } }] };

const describe = (error: NovastarterError): string => `${error.code} answered with ${error.status}`;
```
