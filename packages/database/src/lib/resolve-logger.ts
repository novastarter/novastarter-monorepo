import { type Logger, useLogger } from '@novastarter/logger';
import type { DatabaseDriverCommonConfig } from '../types.js';

/**
 * The logger a driver reports through: the location's own or the process one, bound to the location's label.
 *
 * With a `label` the logger is a child carrying `database`, so every line the driver writes — a pool error, a failed
 * boot, a query with `queryLogging` — says which location it came from. Without one, the logger is handed back as
 * it is: a driver built by hand keeps the logger it was given untouched.
 *
 * @param config - The driver's options; only `logger` and `label` are read.
 * @returns The logger to report through.
 * @example
 * ```ts
 * this.logger = resolveLogger(config);
 * ```
 */
export const resolveLogger = (config: Pick<DatabaseDriverCommonConfig, 'logger' | 'label'>): Logger => {
	const logger = config.logger ?? useLogger();

	// The manager labels every location it builds; a caller need not
	return config.label === undefined ? logger : logger.child({ database: config.label });
};
