/**
 * Tests of `auth/tokens/one-time-token-id`.
 */
import { describe, expect, test } from 'vitest';
import { hashToken } from '../utils/index.js';
import { oneTimeTokenId } from './one-time-token-id.js';

describe('oneTimeTokenId', () => {
	test('Is the hash of a link token, whitespace trimmed', () => {
		// 1. A pasted token often carries a space or a newline; it is not part of the token
		expect(oneTimeTokenId('abc')).toBe(hashToken('abc'));
		expect(oneTimeTokenId('  abc\n')).toBe(hashToken('abc'));
	});

	test('Binds a code to its user', () => {
		// 1. The same code of two users has two ids, so codes do not collide across users
		expect(oneTimeTokenId('123456', 'user-1')).not.toBe(oneTimeTokenId('123456', 'user-2'));
		expect(oneTimeTokenId('123456', 'user-1')).not.toBe(oneTimeTokenId('123456'));

		// 2. The code is trimmed there too
		expect(oneTimeTokenId(' 123456 ', 'user-1')).toBe(oneTimeTokenId('123456', 'user-1'));
	});

	test('Separates the user from the code, so no pair hashes like another', () => {
		// 1. `user-1` + `23456` and `user-12` + `3456` would be the same text without a separator
		expect(oneTimeTokenId('23456', 'user-1')).not.toBe(oneTimeTokenId('3456', 'user-12'));
	});
});
