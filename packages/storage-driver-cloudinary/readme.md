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

Anywhere later: `useStorage().location('uploads').write(path, stream, type)` and the rest of the `StorageDriver`
contract.

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
