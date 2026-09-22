/**
 * Tests of `memory/utils/escape-glob`.
 */
import { expect, test } from 'vitest';
import { escapeGlob } from './escape-glob.js';

test('Escapes every glob operator and leaves the rest alone', () => {
	// 1. Each operator gets a backslash, so `MATCH` reads it as the literal character
	expect(escapeGlob('tenant[1]')).toBe('tenant\\[1\\]');
	expect(escapeGlob('app*')).toBe('app\\*');
	expect(escapeGlob('a?b')).toBe('a\\?b');
	expect(escapeGlob('back\\slash')).toBe('back\\\\slash');

	// 2. Text without operators is unchanged, so the common namespace produces the pattern it always did
	expect(escapeGlob('app-cache')).toBe('app-cache');
	expect(escapeGlob('')).toBe('');
});
