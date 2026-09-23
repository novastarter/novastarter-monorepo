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
		bucket: env.STORAGE_GCS_BUCKET,
		root: 'uploads',
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Any other request

`call()` reaches any endpoint of the GCS JSON API with an access token of the client's Application Default Credentials —
IAM policies, bucket metadata, lifecycle rules, notifications. The method is the verb and the path under `/storage/v1`;
a `{name}` in it is filled from the parameter of that name, URL-encoded, and that parameter is not sent again;
`{bucket}` without one stands for the location's bucket. The parameters of a `GET`, `HEAD` or `DELETE` go in the query,
the rest as the JSON body. Every call answers `{ status, headers, data }`, header names lower-cased.

```ts
const uploads = useStorage().location('uploads');

const { data: policy } = await uploads.call!('GET /b/{bucket}/iam', { optionsRequestedPolicyVersion: 3 });

await uploads.call!('PATCH /b/{bucket}', { versioning: { enabled: true } });

// `{object}` takes the `object` parameter, encoded: /b/<bucket>/o/media%2Fa.jpg
const { data, headers } = await uploads.call!('GET /b/{bucket}/o/{object}', { object: 'media/a.jpg' });

console.log(policy, data, headers['etag']);
```

A full URL may point at `storage.googleapis.com` or the host of the configured `apiEndpoint`; any other host, like a
placeholder nobody filled, is refused before a request is made. Object names in a path are not placed under `root`. A
refusal throws `ProviderCallError` with GCS's status and its `{ error: { code, message } }` body, a 429
`HitRateLimitError`; a failed call is not retried. The timeout — 30 seconds by default — covers fetching the token as
well as the request. `call()` covers plain requests only; signed URLs and streams go through the SDK client.

## The SDK client

`client` of the driver — what `location()` answers — is the location's `Bucket` of `@google-cloud/storage`, with its
Application Default Credentials and `apiEndpoint`: signed URLs, streamed uploads and downloads, object metadata.
`client.storage` is the `Storage` behind it, for other buckets and HMAC keys. Object names are not placed under `root`.

```ts
import type { StorageDriverGcs } from '@novastarter/storage-driver-gcs';

const { client } = useStorage().location('uploads') as StorageDriverGcs;

const [url] = await client.file('report.pdf').getSignedUrl({ action: 'read', expires: Date.now() + 3_600_000 });
```

## Options

| Option          | Required | Description                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------- |
| `bucket`        | yes      | Bucket every operation targets.                                                     |
| `root`          | —        | Path prefix every file is placed under; a root directory inside the bucket.         |
| `apiEndpoint`   | —        | Custom API endpoint, for emulators or private access points.                        |
| `tus.enabled`   | —        | Whether chunked uploads are in use; turns on validation of `chunkSize`.             |
| `tus.chunkSize` | —        | Resumable chunk size in bytes; a power of two multiple of 256 KiB, as GCS requires. |
