import type { RedisConfig } from '@novastarter/redis';
import type { AppEnv } from '../env';

/**
 * Redis locations by name: the servers the app reaches, when it has any.
 *
 * @param env - The app's variables.
 * @returns Location name → connection; empty without a `REDIS`, in which case every subsystem runs in-process.
 */
export const redisConfig = (env: AppEnv): Record<string, RedisConfig> => (env.REDIS ? { default: env.REDIS } : {});
