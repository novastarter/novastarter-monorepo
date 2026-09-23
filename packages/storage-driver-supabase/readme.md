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
		bucket: env.STORAGE_SUPABASE_BUCKET,
		projectId: env.STORAGE_SUPABASE_PROJECT_ID,
		serviceRole: env.STORAGE_SUPABASE_SERVICE_ROLE,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Any other request

`call()` reaches any endpoint of the Supabase Storage API with the location's service-role key — buckets, signed URLs,
bucket settings. The method is the verb and the path under the Storage API root
(`https://<projectId>.supabase.co/storage/v1`, or the configured `endpoint`); a `{name}` in it is filled from the
parameter of that name, URL-encoded, and that parameter is not sent again; `{bucket}` without one stands for the
location's bucket. The parameters of a `GET`, `HEAD` or `DELETE` go in the query, the rest as the JSON body (multipart
when a `Blob` is among them). Every call answers `{ status, headers, data }`, header names lower-cased.

```ts
const uploads = useStorage().location('uploads');

const { data: buckets, headers } = await uploads.call!<{ id: string; public: boolean }[]>('GET /bucket');

const { data } = await uploads.call!<{ signedURL: string }>('POST /object/sign/{bucket}/report.pdf', {
	expiresIn: 3600,
});

// `{id}` takes the `id` parameter: /bucket/avatars
const { data: avatars } = await uploads.call!<{ public: boolean }>('GET /bucket/{id}', { id: 'avatars' });

console.log(buckets, data.signedURL, avatars.public, headers['content-type']);
```

A full URL may point only at the host of the Storage API root; any other host, like a placeholder nobody filled, is
refused before a request is made. Object names in a path are not placed under `root`. A refusal throws
`ProviderCallError` with Supabase's status and answer, a 429 `HitRateLimitError`. The default timeout is 30 seconds.

## Options

| Option          | Required | Description                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `bucket`        | yes      | Storage bucket every operation targets.                                      |
| `serviceRole`   | yes      | Service-role key; sent as `apikey` and bearer token.                         |
| `projectId`     | one of   | Hosted project id, expanded to `https://<projectId>.supabase.co/storage/v1`. |
| `endpoint`      | one of   | Custom endpoint for self-hosting; must include the `/storage/v1` path.       |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.  |
| `tus.chunkSize` | —        | Bytes sent per TUS PATCH request.                                            |
