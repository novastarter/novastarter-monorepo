import type { EnvType } from '../types/env-type.js';

/**
 * Guess the type of a value that carries no cast prefix and has no type-map entry.
 *
 * The guess is deliberately conservative about numbers: a leading zero, a value outside the safe-integer range or an
 * empty string stays a string, so identifiers such as phone numbers or zero-padded codes are not mangled.
 *
 * @param value - Raw value from the environment or a config file.
 * @returns The guessed type; `json` doubles as the "leave it as is" answer because `tryJson` returns the input
 * untouched when it is not JSON.
 */
export const guessType = (value: unknown): EnvType => {
	// 1. Real booleans and their two literal spellings
	if (typeof value === 'boolean' || value === 'true' || value === 'false') {
		return 'boolean';
	}

	// 2. Numbers: real ones, or numeric strings that would survive a round trip through `Number` unchanged
	if (
		typeof value === 'number' ||
		(!String(value).startsWith('0') &&
			!isNaN(Number(value)) &&
			String(value).length > 0 &&
			Number(value) >= Number.MIN_SAFE_INTEGER &&
			Number(value) <= Number.MAX_SAFE_INTEGER)
	) {
		return 'number';
	}

	// 3. A comma means a list; real arrays are lists already
	if (Array.isArray(value) || String(value).includes(',')) {
		return 'array';
	}

	// 4. Everything else is attempted as JSON and otherwise passed through unchanged
	return 'json';
};
