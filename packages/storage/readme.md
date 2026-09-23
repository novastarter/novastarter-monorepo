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
import { StorageDriverLocal } from '@novastarter/storage-driver-local';
import { StorageDriverS3 } from '@novastarter/storage-driver-s3';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('local', StorageDriverLocal);
storage.registerDriver('s3', StorageDriverS3);

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
and `locationNames()` inspect the registry, `instantiated()` lists what was built so far, `close()` releases the drivers
built so far at shutdown — the S3 client's connection pool, say — and keeps the registrations.

## Errors

`stat()` throws `StorageFileNotFoundError` (code `STORAGE_FILE_NOT_FOUND`, status 404) when there is no object at the
path, whichever backend serves the location. `read()` does the same where the backend refuses the read up front; the
local driver opens a lazy stream, so a missing file surfaces as an error on the stream instead.

```ts
import { StorageFileNotFoundError, useStorage } from '@novastarter/storage';

try {
	const { size } = await useStorage().location('uploads').stat('avatars/ada.png');
} catch (error) {
	if (error instanceof StorageFileNotFoundError) return null;
	throw error;
}
```

A driver refuses a missing or invalid option at construction with a plain `Error` naming it:
`The s3 storage driver needs a "bucket"`.

## Any other request

A driver may implement `call(method, params, options)`: a request of its provider's own API with the location's
credentials, timeout and errors, for whatever the contract does not cover. `method` is the verb and path of a REST API
(`POST /v1/refunds`), a full URL on one of the provider's own hosts, or the command name of an RPC-style SDK; the
parameters are the query of a `GET`/`HEAD`/`DELETE` and the body otherwise; `options` takes a `timeout`, a `signal` and
extra `headers` — a `content-type` among them picks JSON, a form or multipart. The answer is
`{ status, headers, data }`: the headers lower-cased, the provider's JSON, or its text. An error status throws
`ProviderCallError` of `@novastarter/errors`, with the provider's status and answer in `extensions`; a 429 throws
`HitRateLimitError`. Each driver's readme names its endpoints and hosts.

```ts
await useStorage().location('uploads').call?.('GetBucketVersioning');
```

`local` has no API and no `call()`.

A `{name}` in the path is filled from the parameter of that name and not sent again; headers and a timeout for every
call of a location go in its registration's `call`:

```ts
useStorage().registerLocation('uploads', {
	driver: 's3',
	options: { bucket: 'uploads' },
	call: { timeout: 10_000 },
});

const { status, headers, data } = await useStorage().location('uploads').call!('GetBucketVersioning', {});
```

## Writing a driver

A driver is a class taking its options in the constructor and implementing `StorageDriver` — or `TusDriver` for
resumable uploads — from this package; see `@novastarter/storage-driver-local` for the smallest one. Every path a driver
gets is relative to its configured root and uses forward slashes. `stat()` throws `StorageFileNotFoundError` for a
missing object; a missing option is refused in the constructor with `The <name> storage driver needs a "<option>"`;
`close()`, when the SDK keeps connections open, releases them. The package registers its options in the driver map, so a
location naming it is type-checked:

```ts
declare module '@novastarter/storage' {
	interface StorageDrivers {
		minio: StorageDriverMinioConfig;
	}
}
```
