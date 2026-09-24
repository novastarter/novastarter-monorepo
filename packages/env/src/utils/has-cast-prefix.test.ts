/**
 * Tests of `env/utils/has-cast-prefix`.
 */
import { expect, test, vi } from 'vitest';
import { getCastFlag } from './has-cast-prefix.js';

vi.mock('../constants/env-types.js', () => ({
	ENV_TYPES: ['test'],
}));

test('Returns null if value is not a string', () => {
	// Prefixes only exist in strings; a number, object or boolean from a JS/YAML config is already typed
	expect(getCastFlag(123)).toBe(null);
	expect(getCastFlag({ hello: 'world' })).toBe(null);
	expect(getCastFlag(false)).toBe(null);
});

test('Returns null if string value does not contain a colon', () => {
	// Without a colon there is nothing that could be a prefix
	expect(getCastFlag('hello')).toBe(null);
});

test('Returns null if cast flag is not a valid env type', () => {
	// An unknown word before a colon is plain data (a URL scheme, say), not a cast instruction
	expect(getCastFlag('hello:world')).toBe(null);
});

test('Returns test flag if exists in env types const', () => {
	// The mocked ENV_TYPES isolates the check itself: a known prefix is returned as is
	expect(getCastFlag('test:foo')).toBe('test');
});
