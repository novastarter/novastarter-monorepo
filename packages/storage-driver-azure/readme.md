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

`call()` reaches any operation of the Blob service REST API on the location's account — service properties, container
metadata, leases, tags, access tiers. The method is the verb and the path from the blob endpoint; `{container}` in it
stands for the location's container. Every parameter goes in the query, except `body`: a string (XML) or a `Blob` sent
as the request body. Headers such as `x-ms-meta-*` go in `options.headers`.

```ts
const uploads = useStorage().location('uploads');

const xml = await uploads.call?.<string>('GET /', { restype: 'service', comp: 'properties' });

await uploads.call?.(
	'PUT /{container}',
	{ restype: 'container', comp: 'metadata' },
	{ headers: { 'x-ms-meta-owner': 'media' } },
);
```

Each request is authorised with an account SAS signed for it alone from the account key and valid for five minutes;
operations an account SAS cannot authorise are refused by Azure. A full URL may point only at the host of the blob
endpoint (`<accountName>.blob.core.windows.net`, or the configured `endpoint`); any other host is refused before a SAS
is signed. The answer is XML text for most operations. A refusal throws `ProviderCallError` with Azure's status and XML
answer, the SAS struck from it; so does a redirect, which is not followed, since the SAS rides in the URL. A 429 throws
`HitRateLimitError`. The default timeout is 30 seconds.

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
