# `@novastarter/storage`

Object storage abstraction layer for Novastarter.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-s3
```

One driver package per backend: `storage-driver-local`, `storage-driver-s3`, `storage-driver-gcs`,
`storage-driver-azure`, `storage-driver-cloudinary`, `storage-driver-supabase`.

## Usage

At start-up, once — drivers as classes, locations as explicit options; a driver is built on the location's first use.
The same driver can back several locations with different credentials, and `driver` decides the type of `options`; `env`
is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { DriverLocal } from '@novastarter/storage-driver-local';
import { DriverS3 } from '@novastarter/storage-driver-s3';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('local', DriverLocal);
storage.registerDriver('s3', DriverS3);

storage.registerLocation('default', {
	driver: 'local',
	options: {
		root: env.STORAGE_LOCAL_ROOT,
	},
});

storage.registerLocation('uploads', {
	driver: 's3',
	options: {
		bucket: env.STORAGE_UPLOADS_BUCKET,
		region: env.STORAGE_UPLOADS_REGION,
		key: env.STORAGE_UPLOADS_KEY,
		secret: env.STORAGE_UPLOADS_SECRET,
	},
});

storage.registerLocation('backups', {
	driver: 's3',
	options: {
		bucket: env.STORAGE_BACKUPS_BUCKET,
		endpoint: env.STORAGE_BACKUPS_ENDPOINT,
		forcePathStyle: true,
		key: env.STORAGE_BACKUPS_KEY,
		secret: env.STORAGE_BACKUPS_SECRET,
	},
});
```

Anywhere later:

```ts
import { supportsTus, useStorage } from '@novastarter/storage';

const uploads = useStorage().location('uploads');

await uploads.write('avatars/ada.png', stream, 'image/png');
const file = await uploads.read('avatars/ada.png', {
	range: {
		start: 0,
		end: 1023,
	},
});

for await (const path of uploads.list('avatars/')) {
	// …
}

if (supportsTus(uploads)) {
	await uploads.createChunkedUpload('videos/talk.mp4', context);
}
```

`registerLocation()` checks that the driver exists and keeps the options; the first `location(name)` builds the driver,
so an unused location never opens a client. `location(name)` throws for a name nobody registered; `hasLocation(name)`
and `locationNames()` inspect the registry, `instantiated()` lists what was built so far.

## Writing a driver

A driver is a class taking its options in the constructor and implementing `Driver` — or `TusDriver` for resumable
uploads — from this package; see `@novastarter/storage-driver-local` for the smallest one. Every path a driver gets is
relative to its configured root and uses forward slashes. The package registers its options in the driver map, so a
location naming it is type-checked:

```ts
declare module '@novastarter/storage' {
	interface StorageDrivers {
		minio: DriverMinioConfig;
	}
}
```
