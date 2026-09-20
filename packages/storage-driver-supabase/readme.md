# `@novastarter/storage-driver-supabase`

Supabase Storage driver for `@novastarter/storage`.

## Description

Objects in a Supabase Storage bucket, hosted (`projectId`) or self-hosted (`endpoint`), with the service-role key so
row-level security is bypassed. Resumable (TUS) uploads are supported.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-supabase
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverSupabase } from '@novastarter/storage-driver-supabase';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('supabase', DriverSupabase);

storage.registerLocation('uploads', {
	driver: 'supabase',
	options: {
		bucket: env['STORAGE_UPLOADS_BUCKET'] as string,
		projectId: env['STORAGE_UPLOADS_PROJECT_ID'] as string,
		serviceRole: env['STORAGE_UPLOADS_SERVICE_ROLE'] as string,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `Driver` interface.

## Options

| Option          | Required | Description                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `bucket`        | yes      | Storage bucket every operation targets.                                      |
| `serviceRole`   | yes      | Service-role key; sent as `apikey` and bearer token.                         |
| `projectId`     | one of   | Hosted project id, expanded to `https://<projectId>.supabase.co/storage/v1`. |
| `endpoint`      | one of   | Custom endpoint for self-hosting; must include the `/storage/v1` path.       |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.  |
| `tus.chunkSize` | —        | Bytes sent per TUS PATCH request.                                            |
