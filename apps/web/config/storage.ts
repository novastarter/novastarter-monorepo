import type { StorageDrivers } from '@novastarter/storage';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * The `default` storage location: where files live.
 *
 * @param env - The app's variables.
 * @returns The location to register; the local disk unless the app adds a bucket.
 */
export const storageConfig = (env: AppEnv): LocationConfig<StorageDrivers> => ({
	driver: 'local',
	options: {
		root: env.STORAGE_LOCAL_ROOT,
	},
});
