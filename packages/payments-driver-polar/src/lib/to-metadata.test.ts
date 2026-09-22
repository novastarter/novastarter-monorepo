/**
 * Tests of `to-metadata`: how Polar's mixed-type metadata becomes the kit's flat string metadata.
 */
import { describe, expect, test } from 'vitest';
import { toMetadata } from './to-metadata.js';

describe('toMetadata', () => {
	test('Writes every value out as a string', () => {
		// 1. Numbers and booleans are written the way `String()` writes them, so a consumer reads one type
		expect(toMetadata({ a: 'x', b: 2, c: true })).toStrictEqual({ a: 'x', b: '2', c: 'true' });

		// 2. Polar answers `null` for no metadata; the kit's shape is never nullable
		expect(toMetadata(null)).toStrictEqual({});
		expect(toMetadata(undefined)).toStrictEqual({});
	});
});
