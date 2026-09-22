import type { Logger } from '@novastarter/logger';
import type { QueryLogger, QueryLoggingOptions } from '../types.js';

/**
 * Build the query logger a driver hands to Drizzle: every query goes to the kit logger at `debug`.
 *
 * `debug` rather than `info`, since a query line per request floods a production log; the application turns them on
 * by lowering its log level, and the driver only wires this in when its `queryLogging` option is set. The line
 * carries the SQL text and the parameter count; the values themselves are logged only when `params` is set, since
 * they may carry what a user typed — password hashes, tokens, PII — and the logger's redaction works on known paths,
 * which cannot reach values inside the `params` array.
 *
 * @param logger - Where the queries go.
 * @param options - Whether the bound parameter values join the SQL text; the count only unless `params` is set.
 * @returns A logger of the shape Drizzle's `logger` option takes.
 * @example
 * ```ts
 * const db = drizzle(pool, { logger: createQueryLogger(useLogger()) });
 * ```
 */
export const createQueryLogger = (logger: Logger, options: QueryLoggingOptions = {}): QueryLogger => ({
	logQuery(query: string, params: unknown[]): void {
		// 1. One structured line per query; the SQL text always, and the values only on request — the redaction of
		//    the kit logger cannot reach inside an array, so a debug-level production log would otherwise write
		//    passwords and PII verbatim. The count keeps the line useful without the values
		if (options.params) {
			logger.debug({ query, params }, 'Database query');

			return;
		}

		// 2. The default line: the SQL with its parameter count, so a slow query is still told from a fast one
		logger.debug({ query, paramCount: params.length }, 'Database query');
	},
});
