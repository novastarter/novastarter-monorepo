import { type CreateLoggerOptions, resolveLogStyle } from '@novastarter/logger';
import type { AppEnv } from '../env';

/**
 * Options of the process logger.
 *
 * @param env - The app's variables.
 * @returns What `createLogger()` takes.
 */
export const loggerConfig = (env: AppEnv): CreateLoggerOptions => ({
	level: env.LOG_LEVEL,
	style: resolveLogStyle(env),
	pino: { name: 'web' },
});
