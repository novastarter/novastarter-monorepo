/**
 * Tests of `auth/passwords/scrypt-params`.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_SCRYPT_PARAMS, formatHash, MAX_SCRYPT_MEMORY, maxmem, parseHash } from './scrypt-params.js';

describe('formatHash / parseHash', () => {
	test('Roundtrips the cost, the salt and the key through the PHC string', () => {
		const salt = Buffer.from('0123456789abcdef');
		const key = Buffer.alloc(32, 7);
		const hash = formatHash({ ln: 10, r: 8, p: 2 }, salt, key);

		// 1. Base64 without its `=` padding, as PHC wants
		expect(hash).toBe(
			`$scrypt$ln=10,r=8,p=2$${salt.toString('base64').replace(/=+$/, '')}$${key.toString('base64').replace(/=+$/, '')}`,
		);

		expect(hash).not.toContain('=$');

		// 2. Parsed back to the same parts
		expect(parseHash(hash)).toStrictEqual({ params: { ln: 10, r: 8, p: 2 }, salt, key });
	});

	test('Refuses strings of another shape', () => {
		// 1. Missing parts, another algorithm, padding and parameters out of order are all not this package's hashes
		for (const hash of [
			'',
			'$scrypt$ln=4,r=8,p=1$c2FsdA',
			'$scrypt$ln=4,r=8,p=1$c2FsdA==$a2V5',
			'$scrypt$r=8,ln=4,p=1$c2FsdA$a2V5',
			'$bcrypt$ln=4,r=8,p=1$c2FsdA$a2V5',
		]) {
			expect(() => parseHash(hash)).toThrow('The password hash is not a scrypt hash in the PHC format');
		}
	});

	test('Accepts the cost bounds and refuses everything past them', () => {
		// 1. The edges themselves parse
		expect(parseHash('$scrypt$ln=1,r=1,p=1$c2FsdA$a2V5').params).toStrictEqual({ ln: 1, r: 1, p: 1 });
		expect(parseHash('$scrypt$ln=1,r=32,p=16$c2FsdA$a2V5').params).toStrictEqual({ ln: 1, r: 32, p: 16 });

		// 2. One step outside any bound is refused, so a tampered record cannot demand gigabytes
		for (const cost of [
			'ln=0,r=8,p=1',
			'ln=21,r=8,p=1',
			'ln=4,r=0,p=1',
			'ln=4,r=33,p=1',
			'ln=4,r=8,p=0',
			'ln=4,r=8,p=17',
		]) {
			expect(() => parseHash(`$scrypt$${cost}$c2FsdA$a2V5`)).toThrow(
				'The password hash has a scrypt cost out of bounds',
			);
		}
	});

	test('Bounds the memory the cost needs, not only each factor', () => {
		// 1. `128 · 2^20 · 8 · 1` is exactly the ceiling, and is accepted
		expect(128 * 2 ** 20 * 8).toBe(MAX_SCRYPT_MEMORY);
		expect(parseHash('$scrypt$ln=20,r=8,p=1$c2FsdA$a2V5').params).toStrictEqual({ ln: 20, r: 8, p: 1 });

		// 2. Every factor within its bound, yet the product past the ceiling: refused
		for (const cost of ['ln=20,r=32,p=16', 'ln=20,r=8,p=2', 'ln=20,r=9,p=1', 'ln=19,r=32,p=1']) {
			expect(() => parseHash(`$scrypt$${cost}$c2FsdA$a2V5`)).toThrow(
				'The password hash has a scrypt cost out of bounds',
			);
		}
	});
});

describe('maxmem', () => {
	test('Is twice the 128 · N · r · p scrypt needs', () => {
		// 1. The default cost: 128 · 2^17 · 8 = 128 MiB, doubled
		expect(maxmem(DEFAULT_SCRYPT_PARAMS)).toBe(2 * 128 * 2 ** 17 * 8);
		expect(maxmem({ ln: 4, r: 8, p: 2 })).toBe(2 * 128 * 16 * 8 * 2);
	});
});
