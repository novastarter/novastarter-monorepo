# `@novastarter/storage-driver-azure`

Azure Blob Storage driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-azure
```

## Usage

Register the class once at start-up, then a location per container with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverAzure } from '@novastarter/storage-driver-azure';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('azure', StorageDriverAzure);

storage.registerLocation('uploads', {
	driver: 'azure',
	options: {
		containerName: env.STORAGE_AZURE_CONTAINER_NAME,
		accountName: env.STORAGE_AZURE_ACCOUNT_NAME,
		accountKey: env.STORAGE_AZURE_ACCOUNT_KEY,
	},
});
```

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

## Any other request

`call()` makes a read of the Blob service REST API on the location's account — service properties and stats, container
metadata and ACLs, blob tags and properties — or a `DELETE`. The method is a `GET`, `HEAD` or `DELETE` and the path from
the blob endpoint; a `{name}` in it is filled from the parameter of that name, URL-encoded, and that parameter is not
sent again; `{container}` without one stands for the location's container. The parameters go in the query. Every call
answers `{ status, headers, data }`, header names lower-cased; `data` is XML text for most operations. Writes — a `PUT`,
a `POST`, a body — are refused: they go through the SDK client below.

```ts
const uploads = useStorage().location('uploads');

const { data: xml } = await uploads.call!<string>('GET /', { restype: 'service', comp: 'properties' });

// `{blob}` takes the `blob` parameter, encoded: /<container>/media%2Fa.jpg
const { data: tags } = await uploads.call!<string>('GET /{container}/{blob}', { blob: 'media/a.jpg', comp: 'tags' });

// A HEAD's properties arrive in the headers
const { headers } = await uploads.call!('HEAD /{container}/{blob}', { blob: 'media/a.jpg' });

console.log(xml, tags, headers['x-ms-access-tier']);
```

Each request is authorised with an account SAS signed for it alone from the account key and valid for five minutes;
operations an account SAS cannot authorise are refused by Azure. A full URL may point only at the host of the blob
endpoint (`<accountName>.blob.core.windows.net`, or the configured `endpoint`); any other host, like a placeholder
nobody filled, is refused before a request is made. A refusal throws `ProviderCallError` with Azure's status and XML
answer, the SAS struck from it; a redirect to another host is followed without the SAS. A 429 throws
`HitRateLimitError`. The default timeout is 30 seconds.

## The SDK client

`client` of the driver — what `location()` answers — is the location's `ContainerClient` of `@azure/storage-blob`, with
its shared-key credential and endpoint: every write, SAS URLs, leases, streamed uploads and downloads;
`client.getBlockBlobClient(name)` and its kin reach single blobs. Blob names are not placed under `root`.

```ts
import type { StorageDriverAzure } from '@novastarter/storage-driver-azure';

const { client } = useStorage().location('uploads') as StorageDriverAzure;

await client.setMetadata({ owner: 'media' });
await client.getBlockBlobClient('media/a.jpg').setAccessTier('Cool');
```

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
