/**
 * Tests of `database/lib/to-drizzle-options`.
 */
import type { Logger } from '@novastarter/logger';
import { describe, expect, test, vi } from 'vitest';
import { toDrizzleOptions } from './to-drizzle-options.js';

const logger = { debug: vi.fn() } as unknown as Logger;

describe('toDrizzleOptions', () => {
	test('Answers an empty object for a config without options', () => {
		// 1. `toStrictEqual` sees an undefined key as a key: none may be present
		expect(toDrizzleOptions({}, logger)).toStrictEqual({});
	});

	test('Drops the keys given as undefined', () => {
		expect(toDrizzleOptions({ schema: undefined, casing: undefined, queryLogging: false }, logger)).toStrictEqual({});
	});

	test('Copies the schema and casing as given', () => {
		const schema = { users: {} };

		const options = toDrizzleOptions({ schema, casing: 'snake_case' }, logger);

		expect(options).toStrictEqual({ schema, casing: 'snake_case' });
		expect(options.schema).toBe(schema);
	});

	test('Wires a query logger over the given logger only when queryLogging is set', () => {
		// 1. Off: no logger key at all, so Drizzle makes no logger call per query
		expect(toDrizzleOptions({ queryLogging: false }, logger)).not.toHaveProperty('logger');

		// 2. On: the logger reports the SQL text and the parameter count to the kit logger handed in
		const options = toDrizzleOptions({ queryLogging: true }, logger);

		options.logger?.logQuery('select 1', [42]);

		expect(logger.debug).toHaveBeenCalledWith({ query: 'select 1', paramCount: 1 }, 'Database query');
	});

	test('Forwards the queryLogging options to the query logger', () => {
		// 1. The object form asks for the values: they join the SQL text, verbatim as the query bound them
		const options = toDrizzleOptions({ queryLogging: { params: true } }, logger);

		options.logger?.logQuery('select 1', [42]);

		expect(logger.debug).toHaveBeenCalledWith({ query: 'select 1', params: [42] }, 'Database query');
	});
});
