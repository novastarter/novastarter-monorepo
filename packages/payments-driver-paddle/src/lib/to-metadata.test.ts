/**
 * Tests of `to-metadata`: how Paddle's custom data — any JSON — becomes the kit's flat string metadata.
 */
import { describe, expect, test } from 'vitest';
import { toMetadata } from './to-metadata.js';

describe('toMetadata', () => {
	test('Strings stay, scalars are written out, nested values become JSON', () => {
		// One value of every JSON kind proves each is written the way the kit's shapes can carry it
		expect(toMetadata({ a: 'x', b: 2, c: true, d: { e: 1 }, f: [1, 2] })).toStrictEqual({
			a: 'x',
			b: '2',
			c: 'true',
			d: '{"e":1}',
			f: '[1,2]',
		});

		// Paddle sends `null` for custom data never set; the kit's metadata is then empty, not absent
		expect(toMetadata(null)).toStrictEqual({});
	});
});
