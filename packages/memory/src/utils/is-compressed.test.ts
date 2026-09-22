/**
 * Tests of `memory/utils/is-compressed`.
 */
import { expect, test } from 'vitest';
import { isCompressed } from './is-compressed.js';

test('Returns false if byte length is less than 19', () => {
	// 1. A gzip stream is at least 19 bytes; anything shorter cannot be one, whatever it starts with
	const mockArray = new Uint8Array([1, 2, 3]);

	expect(isCompressed(mockArray)).toBe(false);
});

test('Returns false if first byte does not match magic number', () => {
	// 1. The magic number is `1f 8b`; a wrong first byte rules gzip out even with the rest in place
	const mockArray = new Uint8Array([0, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

	expect(isCompressed(mockArray)).toBe(false);
});

test('Returns false if second byte does not match magic number', () => {
	// 1. Both magic bytes are needed; the second one alone wrong is enough to say no
	const mockArray = new Uint8Array([0x1f, 0, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

	expect(isCompressed(mockArray)).toBe(false);
});

test('Returns false if third byte does not compression flag', () => {
	// 1. The third byte is the method; gzip always uses deflate (`08`), so another value is not a stream `decompress` reads
	const mockArray = new Uint8Array([0x1f, 0x8b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

	expect(isCompressed(mockArray)).toBe(false);
});

test('Returns true if third byte does not compression flag', () => {
	// 1. Magic number, deflate method and enough length: a stream `decompress` can read
	const mockArray = new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

	expect(isCompressed(mockArray)).toBe(true);
});
