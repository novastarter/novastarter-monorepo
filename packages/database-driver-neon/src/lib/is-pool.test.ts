/**
 * Tests of `database-driver-neon/lib/is-pool`.
 */
import { describe, expect, test } from 'vitest';
import { isPool } from './is-pool.js';

describe('isPool', () => {
	test('Recognises an object with connect and end methods', () => {
		// 1. Duck typing: what matters is the two methods the driver calls, not the class the object came from
		expect(isPool({ connect: () => {}, end: () => {} } as never)).toBe(true);
	});

	test('Rejects a URL, pool options and an object with one of the methods', () => {
		expect(isPool('postgresql://ep-x.neon.tech/neondb')).toBe(false);
		expect(isPool({ host: 'ep-x.neon.tech', database: 'neondb' })).toBe(false);
		expect(isPool({ connect: () => {} } as never)).toBe(false);
		expect(isPool({ end: () => {} } as never)).toBe(false);
	});
});
