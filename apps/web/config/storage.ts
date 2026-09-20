import type { StorageDrivers } from '@novastarter/storage';
import type { LocationConfig } from '@novastarter/utils';
import type { AppEnv } from '../env';

/**
 * Storage locations by name: where files live.
 *
 * @param env - The app's variables.
 * @returns The locations to register; the local disk unless the app adds a bucket.
 */
export const storageConfig = (env: AppEnv): Record<string, LocationConfig<StorageDrivers>> => ({
	default: { driver: 'local', options: { root: env.STORAGE_LOCAL_ROOT } },
});
