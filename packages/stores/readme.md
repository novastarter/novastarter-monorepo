# `@novastarter/stores`

Shared app state for components and app routes, as [zustand](https://www.npmjs.com/package/zustand) stores.

## Description

Client-side state the web app's components share: each store lives in its own module and is re-exported from the package
root. `react` is a peer dependency, provided by the app.

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
