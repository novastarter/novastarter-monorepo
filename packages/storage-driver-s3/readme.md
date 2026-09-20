# `@novastarter/storage-driver-s3`

Amazon S3 driver for `@novastarter/storage`.

## Description

Objects in an S3 bucket, or any S3-compatible service (MinIO, Cloudflare R2, DigitalOcean Spaces) through `endpoint`.
Uploads stream in multipart, resumable (TUS) uploads are supported. Credentials come from `key` / `secret` or, when both
are left out, from the AWS SDK's default chain (environment, instance role).

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-s3
```

## Usage

Register the class once at start-up, then a location per bucket with the options read from the application's
configuration:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverS3 } from '@novastarter/storage-driver-s3';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('s3', DriverS3);

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

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `Driver` interface.

## Options

| Option                                                     | Required | Description                                                                                             |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `bucket`                                                   | yes      | Bucket every operation targets.                                                                         |
| `root`                                                     | —        | Key prefix every path is placed under; a root directory inside the bucket.                              |
| `key`, `secret`                                            | —        | Access key id and secret; set together, or neither for the SDK's default chain.                         |
| `region`                                                   | —        | AWS region of the bucket.                                                                               |
| `endpoint`                                                 | —        | Custom endpoint for S3-compatible services; `https` unless the value starts with `http://`.             |
| `forcePathStyle`                                           | —        | Address the bucket as a path (`host/bucket`), as most S3-compatible services need.                      |
| `acl`                                                      | —        | Canned ACL applied to written and copied objects.                                                       |
| `serverSideEncryption`, `serverSideEncryptionKmsKeyId`     | —        | Server-side encryption of written and copied objects, and the KMS key for the KMS modes.                |
| `requestChecksumCalculation`, `responseChecksumValidation` | —        | SDK checksum modes, for services that reject them.                                                      |
| `tus.chunkSize`                                            | —        | Preferred multipart part size in bytes; grown automatically when an upload would exceed the part limit. |
