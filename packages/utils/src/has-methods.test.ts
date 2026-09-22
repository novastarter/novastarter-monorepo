/**
 * Tests of `utils/has-methods`.
 */
import { describe, expect, expectTypeOf, test } from 'vitest';
import { hasMethods } from './has-methods.js';

/**
 * The shape the tests narrow to.
 */
type Pool = { connect(): void; end(): void };

describe('hasMethods', () => {
	test('Recognises an object or a function carrying every method', () => {
		// 1. Plain objects, class instances and functions with the members attached all qualify
		expect(hasMethods<Pool>({ connect() {}, end() {} }, ['connect', 'end'])).toBe(true);

		expect(
			hasMethods<Pool>(
				new (class {
					connect() {}
					end() {}
				})(),
				['connect', 'end'],
			),
		).toBe(true);

		expect(
			hasMethods<Pool>(
				Object.assign(() => {}, { connect() {}, end() {} }),
				['connect', 'end'],
			),
		).toBe(true);

		expect(hasMethods<object>({}, [])).toBe(true);
	});

	test('Rejects what is not an object, and an object missing a method or carrying data under its name', () => {
		expect(hasMethods<Pool>(null, ['connect', 'end'])).toBe(false);
		expect(hasMethods<Pool>(undefined, ['connect', 'end'])).toBe(false);
		expect(hasMethods<Pool>('postgresql://localhost/app', ['connect', 'end'])).toBe(false);
		expect(hasMethods<Pool>({ connect() {} }, ['connect', 'end'])).toBe(false);
		expect(hasMethods<Pool>({ connect: true, end() {} }, ['connect', 'end'])).toBe(false);
	});

	test('Narrows a union to the type declaring the methods', () => {
		const connection = {} as string | { host: string } | Pool;

		// 1. The guard narrows both branches: the pool inside, everything else outside
		if (hasMethods<Pool>(connection, ['connect', 'end'])) {
			expectTypeOf(connection).toEqualTypeOf<Pool>();
		} else {
			expectTypeOf(connection).toEqualTypeOf<string | { host: string }>();
		}
	});
});
