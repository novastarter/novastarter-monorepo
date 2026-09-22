/**
 * Tests of `database-driver-turso/lib/is-client`.
 */
import { describe, expect, test } from 'vitest';
import { isClient } from './is-client.js';

describe('isClient', () => {
	test('Recognises an object with execute and close methods', () => {
		// 1. Duck typing: what matters is the two methods the driver calls, not the class the object came from
		expect(isClient({ execute: () => {}, close: () => {} } as never)).toBe(true);
	});

	test('Rejects a URL, a config and an object with one of the methods', () => {
		expect(isClient('file:app.db')).toBe(false);
		expect(isClient({ url: 'libsql://db-org.turso.io', authToken: 'token' })).toBe(false);
		expect(isClient({ execute: () => {} } as never)).toBe(false);
		expect(isClient({ close: () => {} } as never)).toBe(false);
	});
});
