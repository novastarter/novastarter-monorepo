/**
 * Tests of `database-driver-turso/lib/local-file-path`.
 */
import { describe, expect, test } from 'vitest';
import { localFilePath } from './local-file-path.js';

describe('localFilePath', () => {
	test('Reads the path of every file: form libsql accepts', () => {
		// 1. Relative, absolute with one slash, absolute with the empty host, and with `localhost`
		expect(localFilePath('file:./data/app.db')).toBe('./data/app.db');
		expect(localFilePath('file:app.db')).toBe('app.db');
		expect(localFilePath('file:/var/lib/app.db')).toBe('/var/lib/app.db');
		expect(localFilePath('file:///var/lib/app.db')).toBe('/var/lib/app.db');
		expect(localFilePath('file://localhost/var/lib/app.db')).toBe('/var/lib/app.db');
	});

	test('Stops at a query or a fragment', () => {
		expect(localFilePath('file:app.db?mode=ro')).toBe('app.db');
		expect(localFilePath('file:app.db#x')).toBe('app.db');
	});

	test('Answers nothing for a database in memory or a remote one', () => {
		expect(localFilePath(':memory:')).toBeUndefined();
		expect(localFilePath('file::memory:')).toBeUndefined();
		expect(localFilePath('file::memory:?cache=shared')).toBeUndefined();
		expect(localFilePath('file:')).toBeUndefined();
		expect(localFilePath('libsql://db-org.turso.io')).toBeUndefined();
		expect(localFilePath('https://db-org.turso.io')).toBeUndefined();
		expect(localFilePath('wss://db-org.turso.io')).toBeUndefined();
	});
});
