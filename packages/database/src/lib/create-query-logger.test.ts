/**
 * Tests of `database/lib/create-query-logger`.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { createQueryLogger } from './create-query-logger.js';

describe('createQueryLogger', () => {
	test('Logs every query with its parameter count at debug, without the values', () => {
		// Only `debug` is called, so a bare mock stands in for the kit logger
		const logger = { debug: vi.fn() };
		const queryLogger = createQueryLogger(logger as unknown as Logger);

		queryLogger.logQuery('select * from users where id = $1', [42]);

		// The values stay out of the log by default: at debug in production they would carry passwords and PII
		// the logger's redaction cannot reach inside an array
		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select * from users where id = $1', paramCount: 1 },
			'Database query',
		);
	});

	test('Logs the parameter values verbatim when asked for', () => {
		// The opt-in keeps a local debugging session informative
		const logger = { debug: vi.fn() };
		const queryLogger = createQueryLogger(logger as unknown as Logger, { params: true });

		queryLogger.logQuery('select * from users where id = $1', [42]);

		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select * from users where id = $1', params: [42] },
			'Database query',
		);
	});
});
