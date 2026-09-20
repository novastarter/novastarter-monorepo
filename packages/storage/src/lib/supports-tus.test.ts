/**
 * Tests of `storage/lib/supports-tus`.
 */
import { expect, test } from 'vitest';
import type { StorageDriver } from '../driver.js';
import { supportsTus } from './supports-tus.js';

test('Recognises a driver by its tusExtensions getter', () => {
	// 1. The getter is the one member every TUS driver has, so its presence alone is the signal
	const driver = {
		get tusExtensions() {
			return ['creation'];
		},
	} as unknown as StorageDriver;

	expect(supportsTus(driver)).toBe(true);
});

test('Rejects a driver without resumable uploads', () => {
	// 1. A plain driver has none of the chunked-upload members, so the guard must say no
	const driver = { read() {}, write() {} } as unknown as StorageDriver;

	expect(supportsTus(driver)).toBe(false);
});
