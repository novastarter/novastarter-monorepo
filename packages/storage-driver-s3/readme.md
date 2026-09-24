# `@novastarter/storage-driver-s3`

Amazon S3 storage driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-s3
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverS3 } from '@novastarter/storage-driver-s3';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('s3', StorageDriverS3);

storage.registerLocation('uploads', {
	driver: 's3',
	options: {
		bucket: env.STORAGE_S3_BUCKET,
		region: env.STORAGE_S3_REGION,
		key: env.STORAGE_S3_KEY,
		secret: env.STORAGE_S3_SECRET,
	},
});

storage.registerLocation('backups', {
	driver: 's3',
	options: {
		bucket: env.STORAGE_S3_BACKUPS_BUCKET,
		endpoint: env.STORAGE_S3_BACKUPS_ENDPOINT,
		forcePathStyle: true,
		key: env.STORAGE_S3_BACKUPS_KEY,
		secret: env.STORAGE_S3_BACKUPS_SECRET,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Any other request

`call()` runs any S3 command on the location's client, credentials and bucket — the way to versioning, lifecycle rules,
bucket policies, CORS, tagging and anything else the driver has no wrapper for. S3 is an RPC-style SDK, so the method is
the command's name (with or without the SDK's `Command` suffix) and the parameters are its input; `Bucket` is the
location's unless given.

```ts
const uploads = useStorage().location('uploads');

const { data } = await uploads.call!<{ Status?: string }>('GetBucketVersioning');

await uploads.call!('PutBucketLifecycleConfiguration', {
	LifecycleConfiguration: {
		Rules: [{ ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'tmp/' }, Expiration: { Days: 7 } }],
	},
});

const { status } = await uploads.call!('HeadBucket');

console.log(data.Status, status);
```

The answer is `{ status, headers, data }`: the HTTP status, no headers — the SDK does not hand them out — and the
command's output without the SDK's `$metadata`. There are no URLs, so no host list: every request goes to the location's
S3 endpoint. Keys in the parameters are sent as given, not under `root`. A name that is not a command of
`@aws-sdk/client-s3` is refused with `InvalidPayloadError` before anything is sent; a refusal of S3 throws
`ProviderCallError` with its HTTP status and `{ name, message }`, a 429 or a throttling code — S3's 503 `SlowDown` —
`HitRateLimitError`; the timeout is 30 seconds unless `{ timeout }` names another. A `headers` option — the call's or
the location's — is refused with `InvalidPayloadError` rather than dropped: `call()` covers plain commands only.

## The SDK client

`client` of the driver — what `location()` answers — is the location's `S3Client` of `@aws-sdk/client-s3`, with its
credentials, region and endpoint — for presigned URLs, streamed uploads of `@aws-sdk/lib-storage`, paginators, waiters,
or a command with extra headers. Keys are not placed under `root`, and the bucket is yours to name.

```ts
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriverS3 } from '@novastarter/storage-driver-s3';

const { client } = useStorage().location('uploads') as StorageDriverS3;

const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: 'uploads', Key: 'report.pdf' }), {
	expiresIn: 3600,
});
```

## Options

| Option                                                     | Required | Description                                                                                                                               |
| ---------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket`                                                   | yes      | Bucket every operation targets.                                                                                                           |
| `root`                                                     | —        | Key prefix every path is placed under; a root directory inside the bucket.                                                                |
| `key`, `secret`                                            | —        | Access key id and secret; set together, or neither for the SDK's default chain.                                                           |
| `region`                                                   | —        | AWS region of the bucket.                                                                                                                 |
| `endpoint`                                                 | —        | Custom endpoint for S3-compatible services; `https` unless the value starts with `http://`.                                               |
| `forcePathStyle`                                           | —        | Address the bucket as a path (`host/bucket`), as most S3-compatible services need.                                                        |
| `acl`                                                      | —        | Canned ACL applied to written and copied objects.                                                                                         |
| `serverSideEncryption`, `serverSideEncryptionKmsKeyId`     | —        | Server-side encryption of written and copied objects, and the KMS key for the KMS modes.                                                  |
| `requestChecksumCalculation`, `responseChecksumValidation` | —        | SDK checksum modes, for services that reject them.                                                                                        |
| `tus.chunkSize`                                            | —        | Preferred multipart part size in bytes, at least the S3 minimum of 5 MiB; grown automatically when an upload would exceed the part limit. |
| `connectionTimeout`                                        | —        | Time allowed to establish a TCP connection, in milliseconds. Default `5000`.                                                              |
| `socketTimeout`                                            | —        | Time a socket may sit idle before the request is aborted, in milliseconds. Default `120000`.                                              |
| `maxSockets`                                               | —        | Maximum concurrent sockets per host. Default `500`.                                                                                       |
| `keepAlive`                                                | —        | Reuse TCP connections between requests. Default `true`.                                                                                   |

## Resumable uploads

TUS uploads are built on S3 multipart uploads, and S3 accepts no part under 5 MiB except the last one. A `tus.chunkSize`
below that is refused at construction, and every PATCH request but the last has to carry at least 5 MiB —
tus-js-client's default `chunkSize: Infinity` does. Bytes past the last full part of a request are dropped and resent by
the client with its next request, so a request size that is a multiple of `tus.chunkSize` avoids resending; a request
whose bytes could not be stored at all is answered with `400`. A request that fails half-way keeps the upload offset
where it was, and the resent bytes overwrite the parts that did reach S3. Terminating an upload that is still open only
aborts it: an object already under the key is kept, and is removed only when the upload was completed before.
