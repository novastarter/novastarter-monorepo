/**
 * Tests of `utils/defaults`.
 */
import { expect, test } from 'vitest';
import { defaults } from './defaults.js';

test('Returns defaults with input properties assigned', () => {
	// 1. A key the caller sets is kept and a key it leaves out is filled in; the result holds both
	expect(defaults({ input: true }, { default: 'test' })).toEqual({
		input: true,
		default: 'test',
	});
});

test('Overwrites undefined values in input object', () => {
	// 1. An explicit `undefined`, the shape an unset env variable takes, counts as missing rather than as a value
	type Input = { default: undefined | string };

	expect(defaults({ default: undefined } as Input, { default: 'test' })).toEqual({
		default: 'test',
	});
});
