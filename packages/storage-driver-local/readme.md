# `@novastarter/storage-driver-local`

Local filesystem storage driver for `@novastarter/storage`.

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

storage.registerLocation('uploads', {
	driver: 'local',
	options: {
		root: env.STORAGE_LOCAL_ROOT,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Behaviour

- `read()` opens the file lazily, so a missing file is reported on the returned stream, not by the call: the stream is
  destroyed with `StorageFileNotFoundError`, the `node:fs` error attached as `cause`. Any other failure reaches the
  stream as `node:fs` reported it.
- `write()` streams into a temporary sibling (`<path>.<random>.tmp`) and renames it over the target once the whole
  stream went through, so a source that fails mid-way leaves the previous content in place and no partial file behind.
- Resumable (TUS) uploads write their chunks into a staging sibling (`<path>.<random>.tmp`, its id kept in the upload
  context) and rename it over the target when the upload finishes. A file already stored under the path stays readable
  during the upload and is kept when the upload is abandoned, terminated or expired; termination removes only the
  staging file.
- `list()` yields nothing for a prefix whose directory does not exist, the root included before the first write; a
  directory that cannot be read for another reason, a permission error say, rejects with the `node:fs` error.
- `stat()` throws `StorageFileNotFoundError` for a missing file; `exists()` answers `false` for a path that cannot exist
  and rethrows anything else, such as a permission error.

## Options

| Option | Required | Description                                                                                            |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `root` | yes      | Directory every path is placed under; a relative value resolves against the process working directory. |
