/**
 * Tests of `database/lib/create-query-logger`.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { createQueryLogger } from './create-query-logger.js';

describe('createQueryLogger', () => {
	test('Logs every query with its parameters at debug', () => {
		// 1. A bare mock stands in for the kit logger: only `debug` is called, so nothing else needs to exist
		const logger = { debug: vi.fn() };
		const queryLogger = createQueryLogger(logger as unknown as Logger);

		queryLogger.logQuery('select * from users where id = $1', [42]);

		// 2. The SQL and the values are fields of one line, so a viewer can filter on either
		expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
			{ query: 'select * from users where id = $1', params: [42] },
			'Database query',
		);
	});
});
