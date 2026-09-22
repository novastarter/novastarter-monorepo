/**
 * Tests of `errors/errors/invalid-payload`.
 */
import { expect, test } from 'vitest';
import { InvalidPayloadError, messageConstructor } from './invalid-payload.js';

test('Constructs message', () => {
	// 1. The reason is quoted after the fixed opening, so the message reads as one sentence
	expect(messageConstructor({ reason: 'Field "email" is required' })).toMatchInlineSnapshot(
		'"Invalid payload. Field "email" is required."',
	);
});

test('Carries the code, the status and the reason', () => {
	// 1. The reason is the detail a client renders; the cause carries the machine-readable companion for the logs
	const error = new InvalidPayloadError({ reason: 'Field "email" is required' }, { cause: ['email'] });

	expect(error.code).toBe('INVALID_PAYLOAD');
	expect(error.status).toBe(400);
	expect(error.extensions).toStrictEqual({ reason: 'Field "email" is required' });
	expect(error.cause).toStrictEqual(['email']);
});
