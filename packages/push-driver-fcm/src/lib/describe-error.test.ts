/**
 * Tests of `describe-error`: how what `firebase-admin` throws becomes the error `sendPush()` reports.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

/**
 * An error the way the SDK throws one: a `FirebaseError` with a `messaging/…` code.
 *
 * @param code - The code.
 * @param message - Its message.
 * @returns The error.
 */
const firebaseError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

describe('describeError', () => {
	test('Reports the dead-token codes and an invalid-argument about the token as gone, naming the code', () => {
		// 1. The two codes Firebase says to delete the token on; the code is the reason the caller can log, the SDK's
		//    error the cause
		const unregistered = firebaseError(
			'messaging/registration-token-not-registered',
			'Requested entity was not found.',
		);

		const gone = describeError(unregistered);

		expect(gone).toBeInstanceOf(PushTargetGoneError);

		expect(gone).toMatchObject({
			extensions: { platform: 'fcm', reason: 'messaging/registration-token-not-registered' },
			cause: unregistered,
		});

		expect(describeError(firebaseError('messaging/invalid-registration-token', 'Invalid token'))).toBeInstanceOf(
			PushTargetGoneError,
		);

		// 2. A malformed token comes back as `invalid-argument`, told apart from a bad payload by the message
		const invalid = firebaseError(
			'messaging/invalid-argument',
			'The registration token is not a valid FCM registration token',
		);

		expect(describeError(invalid)).toMatchObject({ cause: invalid });
	});

	test('Names the code of any other refusal, keeping the SDK error as the cause', () => {
		// 1. An `invalid-argument` about the payload is a bug in the message, not a dead token
		const refused = firebaseError('messaging/invalid-argument', 'Invalid data payload key');
		const described = describeError(refused);

		expect(described).not.toBeInstanceOf(PushTargetGoneError);

		expect(described).toMatchObject({
			message: 'FCM messaging/invalid-argument: Invalid data payload key',
			cause: refused,
		});
	});

	test('Prefixes anything without a code and passes it on as the cause', () => {
		// 1. A network failure never reached FCM, so there is no code: only the message
		const socket = new Error('ECONNRESET');

		expect(describeError(socket)).toMatchObject({ message: 'FCM: ECONNRESET', cause: socket });

		// 2. A thrown non-error is still described rather than crashing the description
		expect(describeError('boom')).toMatchObject({ message: 'FCM: boom', cause: 'boom' });
	});
});
