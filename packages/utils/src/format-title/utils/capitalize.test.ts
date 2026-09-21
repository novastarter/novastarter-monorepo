/**
 * Tests of `utils/format-title/utils/capitalize`.
 */
import { expect, test } from 'vitest';
import { capitalize } from './capitalize.js';

test('Capitalizes input string', () => {
	// 1. Only the first character changes, so an already upper-cased word must come back unchanged
	expect(capitalize('test')).toBe('Test');
	expect(capitalize('Test')).toBe('Test');
	expect(capitalize('TEST')).toBe('TEST');
});
