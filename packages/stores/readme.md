# `@novastarter/stores`

Shared app state for components and app routes, as [zustand](https://www.npmjs.com/package/zustand) stores.

## Installation

```
pnpm add @novastarter/stores
```

## Usage

```ts
import { useAppStore } from '@novastarter/stores';

const hydrated = useAppStore((state) => state.hydrated);
```

A store is a zustand hook: select the slice a component needs and it re-renders when that slice changes.
