/**
 * Tests of `auth/passwords/needs-rehash`.
 */
import { describe, expect, test } from 'vitest';
import { hashPassword } from './hash-password.js';
import { needsRehash } from './needs-rehash.js';
import { DEFAULT_SCRYPT_PARAMS } from './scrypt-params.js';

describe('needsRehash', () => {
	test('Is false for a hash made with the current cost and true for any other cost', async () => {
		const hash = await hashPassword('password', { ln: 4, r: 8, p: 1 });

		// 1. The same cost needs nothing
		expect(needsRehash(hash, { ln: 4, r: 8, p: 1 })).toBe(false);

		// 2. A higher and a lower value of each parameter both count, since the configured cost is the one wanted
		expect(needsRehash(hash, { ln: 5, r: 8, p: 1 })).toBe(true);
		expect(needsRehash(hash, { ln: 3, r: 8, p: 1 })).toBe(true);
		expect(needsRehash(hash, { ln: 4, r: 16, p: 1 })).toBe(true);
		expect(needsRehash(hash, { ln: 4, r: 8, p: 2 })).toBe(true);
	});

	test('Compares with the default cost when none is given', () => {
		// 1. Parsing needs no scrypt run, so hand-written hashes are enough here
		const low = '$scrypt$ln=4,r=8,p=1$c2FsdHNhbHQ$a2V5a2V5';
		const current = `$scrypt$ln=${DEFAULT_SCRYPT_PARAMS.ln},r=${DEFAULT_SCRYPT_PARAMS.r},p=${DEFAULT_SCRYPT_PARAMS.p}$c2FsdHNhbHQ$a2V5a2V5`;

		expect(needsRehash(low)).toBe(true);
		expect(needsRehash(current)).toBe(false);
	});

	test('Throws on a hash that is not a scrypt PHC string', () => {
		// 1. A broken record is not silently treated as needing a rehash
		expect(() => needsRehash('plain-text-password')).toThrow('not a scrypt hash in the PHC format');
	});
});
