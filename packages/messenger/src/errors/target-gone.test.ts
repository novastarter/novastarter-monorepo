/**
 * Tests of `messenger/errors/target-gone`.
 */
import { isNovastarterError } from '@novastarter/errors';
import { expect, test } from 'vitest';
import { MessengerTargetGoneError } from './target-gone.js';

test('Carries the code, the status and the reason in the message', () => {
	const cause = new Error('403 Forbidden');
	const error = new MessengerTargetGoneError({ reason: 'Forbidden: bot was blocked by the user' }, { cause });

	// A dead chat answers 410, like a dead push target
	expect(error.code).toBe('MESSENGER_TARGET_GONE');
	expect(error.status).toBe(410);
	expect(error.message).toBe('The messenger recipient is gone: Forbidden: bot was blocked by the user');
	expect(error.extensions).toStrictEqual({ reason: 'Forbidden: bot was blocked by the user' });
	expect(error.cause).toBe(cause);

	// Made by the kit's factory, so the shared type guard recognises it
	expect(isNovastarterError(error, 'MESSENGER_TARGET_GONE')).toBe(true);
});
