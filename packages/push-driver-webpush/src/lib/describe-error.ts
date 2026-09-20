import { PushTargetGoneError } from '@novastarter/push';
import { WebPushError } from 'web-push';
import { GONE_STATUSES } from './constants.js';

/**
 * Turn what `web-push` throws into the error `sendPush()` expects.
 *
 * @param error - What was thrown: a `WebPushError` for a non-2xx answer, a plain error for the network.
 * @returns A {@link PushTargetGoneError} for a dead subscription, else an error naming the status and body with the
 * original as its cause.
 */
export const describeError = (error: unknown): Error => {
	// 1. The push service answered: 404 / 410 mean the subscription is gone for good
	if (error instanceof WebPushError) {
		if (GONE_STATUSES.has(error.statusCode)) {
			return new PushTargetGoneError({ platform: 'webpush', reason: `${error.statusCode} from ${error.endpoint}` });
		}

		const body = error.body?.trim();

		return new Error(`Web push: ${error.statusCode} from ${error.endpoint}${body ? `: ${body}` : ''}`, {
			cause: error,
		});
	}

	// 2. Anything else — the network, a bad key — as is, prefixed
	return new Error(`Web push: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
};
