/**
 * Tests of `utils/format-title/utils/decamelize`.
 */
import { expect, test } from 'vitest';
import { decamelize } from './decamelize.js';

test('Converts camelcase to underscores', () => {
	expect(decamelize('camelCase')).toBe('camel_case');
});
