import { PushTargetGoneError } from '@novastarter/push';
import { GONE_CODES } from './constants.js';
import { PushDriverFcm } from './driver.js';

/**
 * Turn what the SDK throws into the error `sendPush()` expects.
 *
 * @param error - What was thrown: a `FirebaseError` with a `messaging/…` code for a refusal, a plain error for the
 * network.
 * @returns A {@link PushTargetGoneError} for a dead token, else an error naming the code with the original as its
 * cause.
 */
export const describeError = (error: unknown): Error => {
	// 1. A refusal by FCM: the code says whether the token is gone. `invalid-argument` covers a malformed token too,
	//    which the message names
	if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
		const gone =
			GONE_CODES.has(error.code) ||
			(error.code === 'messaging/invalid-argument' && /registration token/i.test(error.message));

		if (gone) {
			return new PushTargetGoneError({ platform: 'fcm', reason: error.code });
		}

		return new Error(`FCM ${error.code}: ${error.message}`, { cause: error });
	}

	// 2. Anything else — the network, a bug — as is, prefixed
	return new Error(`FCM: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};

/**
 * Default export for consumers that import the driver without a named binding.
 */
export default PushDriverFcm;
