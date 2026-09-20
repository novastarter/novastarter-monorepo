# `@novastarter/storage-driver-gcs`

Google Cloud Storage driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-gcs
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverGcs } from '@novastarter/storage-driver-gcs';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('gcs', StorageDriverGcs);

storage.registerLocation('uploads', {
	driver: 'gcs',
	options: {
		bucket: env.STORAGE_UPLOADS_BUCKET,
		root: 'uploads',
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Options

| Option          | Required | Description                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------- |
| `bucket`        | yes      | Bucket every operation targets.                                                     |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.         |
| `apiEndpoint`   | —        | Custom API endpoint, for emulators or private access points.                        |
| `tus.enabled`   | —        | Whether chunked uploads are in use; turns on validation of `chunkSize`.             |
| `tus.chunkSize` | —        | Resumable chunk size in bytes; a power of two multiple of 256 KiB, as GCS requires. |
