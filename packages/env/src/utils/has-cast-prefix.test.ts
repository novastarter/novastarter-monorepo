/**
 * Tests of `env/utils/has-cast-prefix`.
 */
import { expect, test, vi } from 'vitest';
import { getCastFlag } from './has-cast-prefix.js';

vi.mock('../constants/env-types.js', () => ({
	ENV_TYPES: ['test'],
}));

test('Returns null if value is not a string', () => {
	// 1. Prefixes only exist in strings; a number, object or boolean from a JS/YAML config is already typed
	expect(getCastFlag(123)).toBe(null);
	expect(getCastFlag({ hello: 'world' })).toBe(null);
	expect(getCastFlag(false)).toBe(null);
});

test('Returns null if string value does not contain a colon', () => {
	// 1. Without a colon there is nothing that could be a prefix
	expect(getCastFlag('hello')).toBe(null);
});

test('Returns null if cast flag is not a valid env type', () => {
	// 1. An unknown word before a colon is plain data (a URL scheme, say), not a cast instruction
	expect(getCastFlag('hello:world')).toBe(null);
});

test('Returns test flag if exists in env types const', () => {
	// 1. The mocked ENV_TYPES isolates the check itself: a known prefix is returned as is
	expect(getCastFlag('test:foo')).toBe('test');
});
