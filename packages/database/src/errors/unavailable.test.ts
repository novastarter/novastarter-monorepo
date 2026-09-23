/**
 * Tests of `database/errors/unavailable`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { describe, expect, test } from 'vitest';
import { DatabaseUnavailableError, toUnavailableError } from './unavailable.js';

describe('DatabaseUnavailableError', () => {
	test('Names the location, carries the reason and answers 503', () => {
		const error = new DatabaseUnavailableError({ database: 'main', reason: 'connection refused' });

		expect(error.code).toBe('DATABASE_UNAVAILABLE');
		expect(error.status).toBe(503);
		expect(error.message).toBe('Database "main" is unavailable: connection refused');
		expect(error.extensions).toStrictEqual({ database: 'main', reason: 'connection refused' });
	});

	test('Reads without a location for a driver built by hand', () => {
		const error = new DatabaseUnavailableError({ database: undefined, reason: 'connection refused' });

		expect(error.message).toBe('The database is unavailable: connection refused');
	});
});

describe('toUnavailableError', () => {
	test('Wraps an error with its message as the reason and itself as the cause', () => {
		const cause = new Error('ECONNREFUSED 127.0.0.1:5432');

		const error = toUnavailableError(cause, 'main');

		// 1. Recognisable both ways the kit offers, with the backend's error one step away
		expect(error).toBeInstanceOf(DatabaseUnavailableError);
		expect(isNovastarterError(error, 'DATABASE_UNAVAILABLE')).toBe(true);
		expect(error.message).toBe('Database "main" is unavailable: ECONNREFUSED 127.0.0.1:5432');
		expect(error.cause).toBe(cause);
	});

	test("Looks past Drizzle's query wrapper to the connection's own error", () => {
		const cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
		const wrapper = new Error('Failed query: select 1\nparams: ', { cause });

		const error = toUnavailableError(wrapper, 'main');

		// 1. The reason names the real failure, not the query text, and the driver's error is the cause
		expect(error.extensions.reason).toBe('connect ECONNREFUSED 127.0.0.1:5432');
		expect(error.cause).toBe(cause);
	});

	test('Describes an AggregateError without a message by its inner errors', () => {
		const cause = Object.assign(
			new AggregateError(
				[new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')],
				'',
			),
			{ code: 'ECONNREFUSED' },
		);

		const wrapper = new Error('Failed query: select 1\nparams: ', { cause });

		const error = toUnavailableError(wrapper, 'main');

		// 1. Node's refused `localhost` names every attempted address instead of the bare class name
		expect(error.extensions.reason).toBe('connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432');
		expect(error.cause).toBe(cause);
	});

	test('Falls back to the code of an AggregateError without a message or inner errors', () => {
		const cause = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });

		const error = toUnavailableError(cause);

		// 1. The code is the only thing that says what failed
		expect(error.extensions.reason).toBe('ECONNREFUSED');
	});

	test('Takes a thrown value that is no Error as it is', () => {
		const error = toUnavailableError('boom');

		expect(error.message).toBe('The database is unavailable: boom');
		expect(error.extensions).toStrictEqual({ database: undefined, reason: 'boom' });
		expect(error.cause).toBe('boom');
	});
});
