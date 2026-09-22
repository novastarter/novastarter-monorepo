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

	test('Takes a thrown value that is no Error as it is', () => {
		const error = toUnavailableError('boom');

		expect(error.message).toBe('The database is unavailable: boom');
		expect(error.extensions).toStrictEqual({ database: undefined, reason: 'boom' });
		expect(error.cause).toBe('boom');
	});
});
