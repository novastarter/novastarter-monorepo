/**
 * Tests of `env/lib/cast`.
 */
import { toArray, toBoolean, toNumber, tryParseJSON } from '@novastarter/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { cast } from './cast.js';

vi.mock('@novastarter/utils');
vi.mock('../utils/has-cast-prefix.js');

afterEach(() => {
	vi.clearAllMocks();
});

describe('Type extraction', () => {
	test('Uses cast flag if exists', () => {
		vi.mocked(getCastFlag).mockReturnValue('string');

		expect(cast('string:value')).toBe('value');
		expect(getCastFlag).toHaveBeenCalledWith('string:value');
	});

	test('Uses cast flag for array with nested cast flags if exists', () => {
		vi.mocked(getCastFlag).mockImplementation((val) => {
			if (String(val).startsWith('array')) return 'array';
			if (String(val).startsWith('string')) return 'string';
			return 'number';
		});

		vi.mocked(toNumber).mockReturnValue(1);
		vi.mocked(toArray).mockReturnValue(['string:hey', 'number:1']);

		const res = cast('array:string:hey,number:1');

		expect(getCastFlag).toHaveBeenNthCalledWith(1, 'array:string:hey,number:1');
		expect(getCastFlag).toHaveBeenCalledWith('string:hey');
		expect(getCastFlag).toHaveBeenCalledWith('number:1');
		expect(toArray).toHaveBeenCalledWith('string:hey,number:1');
		expect(toNumber).toHaveBeenCalledWith('1');
		expect(res).toEqual(['hey', 1]);
	});

	test('Returns the value untouched without a cast flag', () => {
		vi.mocked(getCastFlag).mockReturnValue(null);

		expect(cast('8055')).toBe('8055');
		expect(cast('true')).toBe('true');

		// 1. A non-string never carries a prefix, so the flag is not even looked up
		expect(cast(42)).toBe(42);
		expect(getCastFlag).not.toHaveBeenCalledWith(42);
	});
});

describe('Casting', () => {
	test('Keeps the payload as it is for string types', () => {
		vi.mocked(getCastFlag).mockReturnValue('string');

		expect(cast('string:value')).toBe('value');
	});

	test('Uses toNumber for number types', () => {
		vi.mocked(getCastFlag).mockReturnValue('number');

		vi.mocked(toNumber).mockReturnValue(123);
		expect(cast('value')).toBe(123);
	});

	test('Uses toBoolean for boolean types', () => {
		vi.mocked(getCastFlag).mockReturnValue('boolean');

		vi.mocked(toBoolean).mockReturnValue(false);
		expect(cast('value')).toBe(false);
	});

	test('Uses RegExp for regex types', () => {
		vi.mocked(getCastFlag).mockReturnValue('regex');
		expect(cast('value')).toBeInstanceOf(RegExp);
	});

	test('Uses toArray for array types', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			return null;
		});

		vi.mocked(toArray).mockReturnValue(['1', '2', '3']);

		expect(cast('array:value')).toEqual(['1', '2', '3']);
	});

	test('Filters empty strings values out of the array', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			return null;
		});

		vi.mocked(toArray).mockReturnValue(['', '']);

		expect(cast('array:,')).toEqual([]);
	});

	test('Filters members that cast to undefined out of the array', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			if (String(v).startsWith('number')) return 'number';
			return null;
		});

		vi.mocked(toArray).mockReturnValue(['number:1', 'number:']);
		vi.mocked(toNumber).mockReturnValueOnce(1).mockReturnValueOnce(undefined);

		// 1. `number:` with no number is "no value", dropped like an empty member rather than kept as a hole
		expect(cast('array:number:1,number:')).toEqual([1]);
	});

	test('Uses tryParseJSON for json types, keeping the payload when it is not JSON', () => {
		vi.mocked(getCastFlag).mockReturnValue('json');

		vi.mocked(tryParseJSON).mockReturnValue('cast-value');
		expect(cast('json:value')).toBe('cast-value');
		expect(tryParseJSON).toHaveBeenCalledWith('value', 'value');
	});
});
