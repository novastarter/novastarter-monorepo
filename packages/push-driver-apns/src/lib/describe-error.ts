import { PushTargetGoneError } from '@novastarter/push';
import { ApnsError } from 'apns2';
import { GONE_REASONS } from './constants.js';

/**
 * Turn what the SDK threw into the error `sendPush()` expects.
 *
 * @param error - The SDK's `ApnsError`, or whatever the network threw.
 * @returns A `PushTargetGoneError` for a dead token, an error naming APNs's status and reason otherwise.
 */
export const describeError = (error: unknown): Error => {
	// 1. A refusal by APNs: the reason says whether the token is gone
	if (error instanceof ApnsError) {
		if (GONE_REASONS.has(error.reason)) {
			return new PushTargetGoneError({ platform: 'apns', reason: error.reason });
		}

		return new Error(`APNs ${error.statusCode} ${error.reason}`, { cause: error });
	}

	// 2. Anything else — the network, a bug — as is, prefixed
	return new Error(`APNs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};
