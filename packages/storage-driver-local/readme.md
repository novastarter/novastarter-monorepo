# `@novastarter/storage-driver-local`

Local filesystem driver for `@novastarter/storage`.

## Description

Every operation maps onto a `node:fs` call under the configured root; caller paths are pinned inside that root, so a
path cannot escape it. Supports resumable (TUS) uploads. The zero-config choice for development and single-instance
deployments.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-local
```

## Usage

Register the class once at start-up, then a location per directory with the options read from the application's
configuration:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverLocal } from '@novastarter/storage-driver-local';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('local', DriverLocal);

storage.registerLocation('default', { driver: 'local', options: { root: env['STORAGE_LOCAL_ROOT'] as string } });
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `Driver` interface.

## Options

| Option | Required | Description                                                                                            |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `root` | yes      | Directory every path is placed under; a relative value resolves against the process working directory. |
