/**
 * Tests of `to-metadata`: how a checkout's custom data, carried under `meta.custom_data` of every delivery, becomes
 * the kit's string-only metadata.
 */
import { describe, expect, test } from 'vitest';
import { toMetadata } from './to-metadata.js';

describe('toMetadata', () => {
	test('Strings stay, scalars are written out, nested values become JSON', () => {
		// The kit writes strings; anything else Lemon Squeezy hands back is written out so no value is lost.
		expect(toMetadata({ a: 'x', b: 2, c: false, d: { e: 1 } })).toStrictEqual({
			a: 'x',
			b: '2',
			c: 'false',
			d: '{"e":1}',
		});

		// A delivery not started by the kit's checkout has no custom data.
		expect(toMetadata(undefined)).toStrictEqual({});
	});
});
