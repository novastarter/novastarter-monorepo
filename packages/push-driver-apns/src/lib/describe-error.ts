import { PushTargetGoneError } from '@novastarter/push';
import { toErrorMessage } from '@novastarter/utils';
import { ApnsError } from 'apns2';
import { GONE_REASONS } from './constants.js';

/**
 * Turn what the SDK threw into the error `sendPush()` expects.
 *
 * @param error - The SDK's `ApnsError`, or whatever the network or the deadline threw.
 * @returns A `PushTargetGoneError` for a dead token, an error naming APNs's status and reason otherwise; either
 * way what was thrown stays as the `cause`.
 */
export const describeError = (error: unknown): Error => {
	// The reason says whether the token is gone. The SDK's error stays as the cause in both branches, so a handler can
	// reach the status, the notification and Apple's timestamp
	if (error instanceof ApnsError) {
		if (GONE_REASONS.has(error.reason)) {
			return new PushTargetGoneError({ platform: 'apns', reason: error.reason }, { cause: error });
		}

		return new Error(`APNs ${error.statusCode} ${error.reason}`, { cause: error });
	}

	// Anything else is the network, the deadline or a bug
	return new Error(`APNs: ${toErrorMessage(error)}`, { cause: error });
};
