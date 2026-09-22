/**
 * Tests of `database-driver-mysql/lib/is-pool`.
 */
import { describe, expect, test } from 'vitest';
import { isPool } from './is-pool.js';

describe('isPool', () => {
	test('Recognises an object with getConnection and end methods', () => {
		// 1. Duck typing: what matters is the two methods the driver calls, not the class the object came from
		expect(isPool({ getConnection: () => {}, end: () => {} } as never)).toBe(true);
	});

	test('Rejects a URI, pool options and an object with one of the methods', () => {
		expect(isPool('mysql://localhost/app')).toBe(false);
		expect(isPool({ host: 'localhost', database: 'app' })).toBe(false);
		expect(isPool({ getConnection: () => {} } as never)).toBe(false);
		expect(isPool({ end: () => {} } as never)).toBe(false);
	});
});
