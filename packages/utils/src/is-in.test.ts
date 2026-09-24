/**
 * Tests of `utils/is-in`.
 */
import { describe, expect, it } from 'vitest';
import { isIn } from './is-in.js';

describe('isIn', () => {
	const array = ['foo', 'bar'] as const;

	it('returns true when string is inside array', () => {
		// A plain string is looked up in an `as const` tuple, which `includes` alone would reject at the type level
		expect(isIn('foo', array)).toBe(true);
	});

	it('returns false when string is not inside array', () => {
		// The guard answers `false` for a string outside the tuple, so the narrowed type is never wrong
		expect(isIn('baz', array)).toBe(false);
	});
});
