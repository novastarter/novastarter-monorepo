import type { RedisConfig } from '@novastarter/redis';
import type { AppEnv } from '../env';

/**
 * The `default` Redis location: the server the app reaches, when it has one.
 *
 * @param env - The app's variables.
 * @returns The connection to register; `undefined` without a `REDIS`, in which case every subsystem runs in-process.
 */
export const redisConfig = (env: AppEnv): RedisConfig | undefined => env.REDIS;
