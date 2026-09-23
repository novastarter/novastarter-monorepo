# `@novastarter/storage-driver-cloudinary`

Cloudinary storage driver for `@novastarter/storage`.

## Installation

```
pnpm add @novastarter/storage @novastarter/storage-driver-cloudinary
```

## Usage

Register the class once at start-up, then a location per account with the options read from the application's
configuration — `env` is the app's typed configuration — the zod schema of the `@novastarter/env` readme.

```ts
import { useStorage } from '@novastarter/storage';
import { StorageDriverCloudinary } from '@novastarter/storage-driver-cloudinary';
import { env } from './env';

const storage = useStorage();

storage.registerDriver('cloudinary', StorageDriverCloudinary);

storage.registerLocation('media', {
	driver: 'cloudinary',
	options: {
		cloudName: env.STORAGE_CLOUDINARY_CLOUD_NAME,
		apiKey: env.STORAGE_CLOUDINARY_API_KEY,
		apiSecret: env.STORAGE_CLOUDINARY_API_SECRET,
		accessMode: 'public',
	},
});
```

Anywhere later: `useStorage().location('media').write(path, stream, type)` and the rest of the `StorageDriver` contract.

## Any other request

`call()` reaches any endpoint of Cloudinary's Admin API with the location's key and secret as basic auth — usage, tags,
metadata fields, upload presets, transformations. The method is the verb and the path under
`https://api.cloudinary.com/v1_1/<cloudName>`; a `{name}` in it is filled from the parameter of that name, URL-encoded,
and that parameter is not sent again. The parameters of a `GET`, `HEAD` or `DELETE` go in the query, the rest as the
JSON body. Every call answers `{ status, headers, data }`, header names lower-cased.

```ts
const media = useStorage().location('media');

const { data: usage, headers } = await media.call!('GET /usage');

const { data } = await media.call!<{ resources: { public_id: string }[] }>('GET /resources/image/upload', {
	max_results: 100,
	prefix: 'avatars/',
});

// `{tag}` takes the `tag` parameter: /resources/image/tags/avatar
const { data: tagged } = await media.call!('GET /resources/image/tags/{tag}', { tag: 'avatar' });

console.log(usage, data.resources, tagged, headers['x-featureratelimit-remaining']);
```

A full URL may point only at `api.cloudinary.com` or a region's `api-eu.cloudinary.com`, `api-ap.cloudinary.com`; any
other host, like a placeholder nobody filled, is refused before a request is made. Public ids are not placed under
`root`. A refusal throws `ProviderCallError` with Cloudinary's status and `{ error: { message } }`; a 429, or the 420
the Admin API answers once the hourly budget is spent, throws `HitRateLimitError`. The default timeout is 30 seconds.

## Options

| Option          | Required | Description                                                                |
| --------------- | -------- | -------------------------------------------------------------------------- |
| `cloudName`     | yes      | Cloudinary cloud name; part of every API and delivery URL.                 |
| `apiKey`        | yes      | API key of the account.                                                    |
| `apiSecret`     | yes      | API secret; only used to sign requests and delivery URLs.                  |
| `accessMode`    | yes      | `public` assets are served openly, `authenticated` ones need a signed URL. |
| `root`          | —        | Path prefix every file is placed under; a root folder inside the account.  |
| `tus.enabled`   | —        | Whether resumable uploads are enabled; only then is `chunkSize` validated. |
| `tus.chunkSize` | —        | Bytes sent per request; at least the Cloudinary minimum.                   |
