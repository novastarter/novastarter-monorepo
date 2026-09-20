# `@novastarter/storage-driver-local`

Local filesystem driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-local
```

## Usage

Register the class once at start-up, then a location per directory with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverLocal } from '@novastarter/storage-driver-local';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('local', StorageDriverLocal);

storage.registerLocation('default', {
	driver: 'local',
	options: {
		root: env.STORAGE_LOCAL_ROOT,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Options

| Option | Required | Description                                                                                            |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `root` | yes      | Directory every path is placed under; a relative value resolves against the process working directory. |
