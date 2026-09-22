/**
 * Tests of `database/lib/create-query-logger`.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { createQueryLogger } from './create-query-logger.js';

describe('createQueryLogger', () => {
	test('Logs every query with its parameter count at debug, without the values', () => {
		// 1. A bare mock stands in for the kit logger: only `debug` is called, so nothing else needs to exist
		const logger = { debug: vi.fn() };
		const queryLogger = createQueryLogger(logger as unknown as Logger);

		queryLogger.logQuery('select * from users where id = $1', [42]);

		// 2. The values stay out of the log by default: at debug in production they would carry passwords and PII
		//    the logger's redaction cannot reach inside an array — the count keeps the line useful
		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select * from users where id = $1', paramCount: 1 },
			'Database query',
		);
	});

	test('Logs the parameter values verbatim when asked for', () => {
		// 1. The opt-in that keeps a local debugging session informative: the values join the SQL text as they are
		const logger = { debug: vi.fn() };
		const queryLogger = createQueryLogger(logger as unknown as Logger, { params: true });

		queryLogger.logQuery('select * from users where id = $1', [42]);

		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select * from users where id = $1', params: [42] },
			'Database query',
		);
	});
});
