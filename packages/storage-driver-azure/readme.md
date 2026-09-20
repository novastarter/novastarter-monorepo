# `@novastarter/storage-driver-azure`

Azure Blob Storage driver for `@novastarter/storage`.

## Description

Blobs in an Azure container, signed with the shared account key; resumable (TUS) uploads append blocks per request.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-azure
```

## Usage

Register the class once at start-up, then a location per container with the options read from the application's
configuration:

```ts
import { useEnv } from '@novastarter/env';
import { useStorage } from '@novastarter/storage';
import { DriverAzure } from '@novastarter/storage-driver-azure';

const env = useEnv();
const storage = useStorage();

storage.registerDriver('azure', DriverAzure);

storage.registerLocation('uploads', {
	driver: 'azure',
	options: {
		containerName: env['STORAGE_UPLOADS_CONTAINER_NAME'] as string,
		accountName: env['STORAGE_UPLOADS_ACCOUNT_NAME'] as string,
		accountKey: env['STORAGE_UPLOADS_ACCOUNT_KEY'] as string,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `Driver` interface.

## Options

| Option          | Required | Description                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------ |
| `containerName` | yes      | Blob container every operation targets.                                        |
| `accountName`   | yes      | Storage account name; also derives the default endpoint.                       |
| `accountKey`    | yes      | Shared account key requests are signed with.                                   |
| `root`          | —        | Path prefix every blob is placed under; a root directory inside the container. |
| `endpoint`      | —        | Custom endpoint, for Azurite or a private endpoint.                            |
| `tus.enabled`   | —        | Whether resumable uploads are switched on; only then is `chunkSize` validated. |
| `tus.chunkSize` | —        | Bytes appended per TUS PATCH request, up to the block limit.                   |
