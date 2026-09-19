# `@novastarter/stores`

Shared Nova app state for use in components and the app routes. Stores are
[zustand](https://www.npmjs.com/package/zustand)-based stores.

## Installation

```shell
pnpm add @novastarter/stores
```

## Usage

```ts
import { useAppStore } from '@novastarter/stores';

const hydrated = useAppStore((state) => state.hydrated);
```

## Additional Resources

- [GitHub Repository](https://github.com/novastarter/novastarter-monorepo)
