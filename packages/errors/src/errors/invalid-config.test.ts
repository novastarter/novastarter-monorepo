/**
 * Tests of `errors/errors/invalid-config`.
 */
import { expect, test } from 'vitest';
import { InvalidConfigError, invalidConfigMessage } from './invalid-config.js';

test('Constructs message', () => {
	expect(invalidConfigMessage({ reason: 'The mysql database driver needs a "connection"' })).toMatchInlineSnapshot(
		'"Invalid config. The mysql database driver needs a "connection"."',
	);
});

test('Carries the code, the status and the reason', () => {
	const cause = new Error('connect ECONNREFUSED');
	const error = new InvalidConfigError({ reason: 'The mysql database driver needs a "connection"' }, { cause });

	expect(error.code).toBe('INVALID_CONFIG');
	expect(error.status).toBe(500);
	expect(error.extensions).toStrictEqual({ reason: 'The mysql database driver needs a "connection"' });
	expect(error.cause).toBe(cause);
});
