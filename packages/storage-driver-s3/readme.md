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
whose bytes could not be stored at all is answered with `400`.
