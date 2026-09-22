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
		expect(cast('regex:value')).toBeInstanceOf(RegExp);
	});

	test('Refuses a broken regex pattern, naming the value', () => {
		// 1. A typo in a prefixed value is a broken configuration, not a missing variable a schema default would cover
		vi.mocked(getCastFlag).mockReturnValue('regex');
		expect(() => cast('regex:(')).toThrow('Cannot cast "regex:(" to a regular expression');
	});

	test('Refuses a number payload that is not a finite number, naming the value', () => {
		vi.mocked(getCastFlag).mockReturnValue('number');
		vi.mocked(toNumber).mockReturnValue(undefined);
		expect(() => cast('number:80O0')).toThrow('Cannot cast "number:80O0" to a number');
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

	test('Refuses an array member that cannot be cast instead of dropping it', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			if (String(v).startsWith('number')) return 'number';
			return null;
		});

		vi.mocked(toArray).mockReturnValue(['number:1', 'number:']);
		vi.mocked(toNumber).mockReturnValueOnce(1).mockReturnValueOnce(undefined);

		// 1. `number:` with no number is a broken member; a list silently one shorter would pass a schema unnoticed
		expect(() => cast('array:number:1,number:')).toThrow('Cannot cast "number:" to a number');
	});

	test('Uses tryParseJSON for json types, keeping the payload when it is not JSON', () => {
		vi.mocked(getCastFlag).mockReturnValue('json');

		vi.mocked(tryParseJSON).mockReturnValue('cast-value');
		expect(cast('json:value')).toBe('cast-value');
		expect(tryParseJSON).toHaveBeenCalledWith('value', 'value');
	});
});
