import type { Logger } from '@novastarter/logger';
import type { QueryLogger } from '../types.js';

/**
 * Build the query logger a driver hands to Drizzle: every query goes to the kit logger at `debug`.
 *
 * `debug` rather than `info`, since a query line per request floods a production log; the application turns them on
 * by lowering its log level, and the driver only wires this in when its `queryLogging` option is set. The parameters
 * go out as they are — they may carry what a user typed, which is what a query log is for, and the logger's
 * redaction applies to its known paths only.
 *
 * @param logger - Where the queries go.
 * @returns A logger of the shape Drizzle's `logger` option takes.
 * @example
 * ```ts
 * const db = drizzle(pool, { logger: createQueryLogger(useLogger()) });
 * ```
 */
export const createQueryLogger = (logger: Logger): QueryLogger => ({
	logQuery(query: string, params: unknown[]): void {
		// 1. One structured line per query; the SQL and its values as fields, so a log viewer can filter on either
		logger.debug({ query, params }, 'Database query');
	},
});
