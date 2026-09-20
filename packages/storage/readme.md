# `@novastarter/storage`

Object storage abstraction layer for Novastarter.

## Description

One interface — `read`, `write`, `delete`, `stat`, `exists`, `move`, `copy`, `list`, plus resumable (TUS) uploads on the
drivers that support them — over the local filesystem, S3, GCS, Azure Blob, Cloudinary and Supabase, one driver package
each. `StorageManager` maps named locations to driver instances: the application registers its drivers and locations
once at start-up, with the options it read from its own configuration, and every consumer asks for a location by name
afterwards. The package reads nothing from the environment. Ported from `@directus/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-s3
```

One driver package per backend: `storage-driver-local`, `storage-driver-s3`, `storage-driver-gcs`,
`storage-driver-azure`, `storage-driver-cloudinary`, `storage-driver-supabase`.

## Usage

At start-up, once — drivers as classes, locations as explicit options. The same driver can back several locations with
different credentials; a location named `default` answers for any name nobody registered:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverLocal } from '@novastarter/storage-driver-local';
import { DriverS3 } from '@novastarter/storage-driver-s3';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('local', DriverLocal);
storage.registerDriver('s3', DriverS3);

storage.registerLocation('default', { driver: 'local', options: { root: env['STORAGE_LOCAL_ROOT'] as string } });

storage.registerLocation('uploads', {
	driver: 's3',
	options: {
		bucket: env['STORAGE_UPLOADS_BUCKET'] as string,
		region: env['STORAGE_UPLOADS_REGION'] as string,
		key: env['STORAGE_UPLOADS_KEY'] as string,
		secret: env['STORAGE_UPLOADS_SECRET'] as string,
	},
});

storage.registerLocation('backups', {
	driver: 's3',
	options: {
		bucket: env['STORAGE_BACKUPS_BUCKET'] as string,
		endpoint: env['STORAGE_BACKUPS_ENDPOINT'] as string,
		forcePathStyle: true,
		key: env['STORAGE_BACKUPS_KEY'] as string,
		secret: env['STORAGE_BACKUPS_SECRET'] as string,
	},
});
```

Anywhere later:

```ts
import { supportsTus, useStorage } from '@novastarter/storage';

const uploads = useStorage().location('uploads');

await uploads.write('avatars/ada.png', stream, 'image/png');
const file = await uploads.read('avatars/ada.png', { range: { start: 0, end: 1023 } });

for await (const path of uploads.list('avatars/')) {
	// …
}

if (supportsTus(uploads)) {
	await uploads.createChunkedUpload('videos/talk.mp4', context);
}
```

`registerLocation()` instantiates the driver at once, so a wrong option fails at start-up rather than on the first
request; `location(name)` throws for a name that has neither a location nor a default. `hasLocation(name)` and
`locationNames()` inspect the registry.

## Writing a driver

A driver is a class taking its options in the constructor and implementing `Driver` — or `TusDriver` for resumable
uploads — from this package; see `@novastarter/storage-driver-local` for the smallest one. Every path a driver gets is
relative to its configured root and uses forward slashes.
