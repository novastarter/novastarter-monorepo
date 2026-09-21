/**
 * Tests of `push/errors/target-gone`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { PushTargetGoneError } from './target-gone.js';

test('Carries the code, the status, the platform and the reason in the message', () => {
	const cause = new Error('410 Gone');
	const error = new PushTargetGoneError({ platform: 'webpush', reason: '410 from https://push.example' }, { cause });

	// 1. A dead target answers 410: what the subscription store deletes on, what an API relays as is
	expect(error.code).toBe('PUSH_TARGET_GONE');
	expect(error.status).toBe(410);
	expect(error.message).toBe('The webpush push target is gone: 410 from https://push.example');
	expect(error.extensions).toStrictEqual({ platform: 'webpush', reason: '410 from https://push.example' });
	expect(error.cause).toBe(cause);

	// 2. Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'PUSH_TARGET_GONE')).toBe(true);
});
