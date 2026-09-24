/**
 * Tests of `describe-error`: how the SDK's refusals and other failures become the errors `sendPush()` expects.
 */
import { PushTargetGoneError } from '@novastarter/push';
import { ApnsError, Notification } from 'apns2';
import { describe, expect, test } from 'vitest';
import { describeError } from './describe-error.js';

/**
 * An `ApnsError` the way the client raises it for a refusal.
 *
 * @param statusCode - The HTTP status APNs answered with.
 * @param reason - Apple's reason string.
 * @returns The error.
 */
const refusal = (statusCode: number, reason: string): ApnsError =>
	new ApnsError({ statusCode, notification: new Notification('tok'), response: { reason, timestamp: Date.now() } });

describe('describeError', () => {
	test('A dead token is a PushTargetGoneError, another refusal names the status and reason', () => {
		// The three reasons that mean the token is dead, whatever the status; the client's error stays as the cause, the
		// same as for any other refusal
		const unregistered = refusal(410, 'Unregistered');
		const gone = describeError(unregistered);

		expect(gone).toBeInstanceOf(PushTargetGoneError);

		expect((gone as InstanceType<typeof PushTargetGoneError>).extensions).toStrictEqual({
			platform: 'apns',
			reason: 'Unregistered',
		});

		expect(gone.cause).toBe(unregistered);

		expect(describeError(refusal(400, 'BadDeviceToken'))).toBeInstanceOf(PushTargetGoneError);
		expect(describeError(refusal(400, 'DeviceTokenNotForTopic'))).toBeInstanceOf(PushTargetGoneError);

		const other = describeError(refusal(403, 'InvalidProviderToken'));

		expect(other).not.toBeInstanceOf(PushTargetGoneError);
		expect(other.message).toBe('APNs 403 InvalidProviderToken');
		expect(other.cause).toBeInstanceOf(ApnsError);

		const network = new Error('socket hang up');
		const described = describeError(network);

		expect(described.message).toBe('APNs: socket hang up');
		expect(described.cause).toBe(network);
	});
});
