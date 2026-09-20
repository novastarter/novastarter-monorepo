# `@novastarter/storage-driver-gcs`

Google Cloud Storage driver for `@novastarter/storage`.

## Description

Objects in a GCS bucket, with resumable (TUS) uploads. The client authenticates the way the Google SDK does —
`GOOGLE_APPLICATION_CREDENTIALS`, the metadata server of the instance — so no credentials are passed in the options.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-gcs
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverGCS } from '@novastarter/storage-driver-gcs';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('gcs', DriverGCS);

storage.registerLocation('uploads', {
	driver: 'gcs',
	options: { bucket: env['STORAGE_UPLOADS_BUCKET'] as string, root: 'uploads' },
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `Driver` interface.

## Options

| Option          | Required | Description                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------- |
| `bucket`        | yes      | Bucket every operation targets.                                                     |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.         |
| `apiEndpoint`   | —        | Custom API endpoint, for emulators or private access points.                        |
| `tus.enabled`   | —        | Whether chunked uploads are in use; turns on validation of `chunkSize`.             |
| `tus.chunkSize` | —        | Resumable chunk size in bytes; a power of two multiple of 256 KiB, as GCS requires. |
