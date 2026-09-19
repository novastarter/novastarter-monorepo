import { describe, expect, it } from 'vitest';
import { isIn } from './is-in.js';

describe('isIn', () => {
	const array = ['foo', 'bar'] as const;

	it('returns true when string is inside array', () => {
		expect(isIn('foo', array)).toBe(true);
	});

	it('returns false when string is not inside array', () => {
		expect(isIn('baz', array)).toBe(false);
	});
});
