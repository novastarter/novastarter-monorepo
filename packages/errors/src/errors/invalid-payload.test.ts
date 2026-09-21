/**
 * Tests of `errors/errors/invalid-payload`.
 */
import { expect, test } from 'vitest';
import { InvalidPayloadError, messageConstructor } from './invalid-payload.js';

test('Constructs message', () => {
	expect(messageConstructor({ reason: 'Field "email" is required' })).toMatchInlineSnapshot(
		'"Invalid payload. Field "email" is required."',
	);
});

test('Carries the code, the status and the reason', () => {
	const error = new InvalidPayloadError({ reason: 'Field "email" is required' }, { cause: ['email'] });

	expect(error.code).toBe('INVALID_PAYLOAD');
	expect(error.status).toBe(400);
	expect(error.extensions).toStrictEqual({ reason: 'Field "email" is required' });
	expect(error.cause).toStrictEqual(['email']);
});
