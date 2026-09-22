import type { Logger } from '@novastarter/logger';
import type { DatabaseDriverCommonConfig, DrizzleOptions } from '../types.js';
import { createQueryLogger } from './create-query-logger.js';

/**
 * Turn the options every driver shares into what its dialect's `drizzle()` call takes.
 *
 * Drizzle declares `schema` and `casing` without `| undefined`, so a config spread straight into `drizzle()` fails to
 * compile under `exactOptionalPropertyTypes` — and at runtime a `schema: undefined` key would still be an explicit
 * value. Only the keys that carry a value are copied. The query logger is wired in only when asked for, so a driver
 * without `queryLogging` costs Drizzle no logger call per query.
 *
 * @typeParam Schema - The Drizzle schema the database is typed with.
 * @param config - The driver's options.
 * @param logger - Where the queries go when `config.queryLogging` is set.
 * @returns The options for `drizzle()`, without undefined keys.
 * @example
 * ```ts
 * const db = drizzle(pool, toDrizzleOptions(config, this.logger));
 * ```
 */
export const toDrizzleOptions = <Schema extends Record<string, unknown>>(
	config: DatabaseDriverCommonConfig<Schema>,
	logger: Logger,
): DrizzleOptions<Schema> => {
	const options: DrizzleOptions<Schema> = {};

	// 1. Copy the two pass-through options only when given, so Drizzle sees no key it would take as a value
	if (config.schema !== undefined) {
		options.schema = config.schema;
	}

	if (config.casing !== undefined) {
		options.casing = config.casing;
	}

	// 2. The query logger is opt-in: on by default it would cost a logger call per query in every deployment
	if (config.queryLogging) {
		options.logger = createQueryLogger(logger);
	}

	return options;
};
