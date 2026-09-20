# `@novastarter/storage-driver-supabase`

Supabase Storage driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-supabase
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverSupabase } from '@novastarter/storage-driver-supabase';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('supabase', StorageDriverSupabase);

storage.registerLocation('uploads', {
	driver: 'supabase',
	options: {
		bucket: env.STORAGE_UPLOADS_BUCKET,
		projectId: env.STORAGE_UPLOADS_PROJECT_ID,
		serviceRole: env.STORAGE_UPLOADS_SERVICE_ROLE,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Options

| Option          | Required | Description                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `bucket`        | yes      | Storage bucket every operation targets.                                      |
| `serviceRole`   | yes      | Service-role key; sent as `apikey` and bearer token.                         |
| `projectId`     | one of   | Hosted project id, expanded to `https://<projectId>.supabase.co/storage/v1`. |
| `endpoint`      | one of   | Custom endpoint for self-hosting; must include the `/storage/v1` path.       |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.  |
| `tus.chunkSize` | —        | Bytes sent per TUS PATCH request.                                            |
