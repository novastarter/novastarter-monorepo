/**
 * Tests of `notifications/lib/channels/push`; `sendPush` of `@novastarter/push` is mocked, its error class is real.
 */
import { PushTargetGoneError, sendPush } from '@novastarter/push';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NotificationRecipient, PushTarget } from '../../types.js';
import { pushChannel } from './push.js';

vi.mock('@novastarter/push', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@novastarter/push')>();

	// 1. Only the transport is faked, so `instanceof PushTargetGoneError` is the real check
	return { ...actual, sendPush: vi.fn(async () => null) };
});

/**
 * A browser and a phone of the same user.
 */
const BROWSER: PushTarget = { subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } } };
const PHONE: PushTarget = { token: 'fcm-token', platform: 'fcm' };

/**
 * The user with both devices.
 */
const RECIPIENT: NotificationRecipient = { userId: 'u1', pushTargets: [BROWSER, PHONE] };

/**
 * One delivery of a paid invoice to {@link RECIPIENT}.
 */
const DELIVERY = {
	notification: { type: 'invoice.paid', userId: 'u1' },
	recipient: RECIPIENT,
	content: { title: 'Invoice paid', tag: 'invoice-1042' },
};

afterEach(() => {
	vi.clearAllMocks();
});

describe('pushChannel', () => {
	test('Reaches a user with a device only', () => {
		// 1. An empty list is no device
		expect(pushChannel().reaches(RECIPIENT)).toBe(true);
		expect(pushChannel().reaches({ userId: 'u1', pushTargets: [] })).toBe(false);
		expect(pushChannel().reaches({ userId: 'u1' })).toBe(false);
	});

	test('Sends the message to every device', async () => {
		// 1. One message per target, each carrying the content
		await pushChannel().send(DELIVERY);

		expect(sendPush).toHaveBeenCalledTimes(2);
		expect(sendPush).toHaveBeenNthCalledWith(1, { title: 'Invoice paid', tag: 'invoice-1042', ...BROWSER });
		expect(sendPush).toHaveBeenNthCalledWith(2, { title: 'Invoice paid', tag: 'invoice-1042', ...PHONE });
	});

	test('Hands a gone device to onGone without failing', async () => {
		const onGone = vi.fn(async () => undefined);

		vi.mocked(sendPush).mockRejectedValueOnce(new PushTargetGoneError({ platform: 'webpush', reason: '410' }));

		// 1. The browser is gone, the phone still gets it, and the delivery succeeds
		await expect(pushChannel({ onGone }).send(DELIVERY)).resolves.toBeUndefined();

		expect(onGone).toHaveBeenCalledWith(BROWSER, 'u1');
		expect(sendPush).toHaveBeenCalledTimes(2);
	});

	test('Tries every device and then throws the first failure', async () => {
		const failure = new Error('push service down');

		vi.mocked(sendPush).mockRejectedValueOnce(failure);

		// 1. The phone is still tried after the browser failed; the job retries on the failure
		await expect(pushChannel().send(DELIVERY)).rejects.toBe(failure);

		expect(sendPush).toHaveBeenCalledTimes(2);
	});

	test('Drops a target the content carries, so the template cannot redirect the message', async () => {
		// 1. Only the recipient's devices are sent to
		await pushChannel().send({
			...DELIVERY,
			content: { ...DELIVERY.content, token: 'evil', platform: 'apns' } as never,
		});

		expect(sendPush).toHaveBeenNthCalledWith(1, { title: 'Invoice paid', tag: 'invoice-1042', ...BROWSER });
		expect(sendPush).toHaveBeenNthCalledWith(2, { title: 'Invoice paid', tag: 'invoice-1042', ...PHONE });
	});

	test('Forgets a gone device even after another failed, and fails when forgetting fails', async () => {
		const failure = new Error('push service down');
		const onGone = vi.fn(async () => undefined);

		// 1. The browser fails, the phone is gone: the phone is still forgotten, and the browser's failure thrown
		vi.mocked(sendPush)
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(new PushTargetGoneError({ platform: 'fcm', reason: '404' }));

		await expect(pushChannel({ onGone }).send(DELIVERY)).rejects.toBe(failure);
		expect(onGone).toHaveBeenCalledWith(PHONE, 'u1');

		// 2. A failing `onGone` is thrown, so the job retries the clean-up
		const goneFailure = new Error('database down');

		vi.mocked(sendPush).mockRejectedValueOnce(new PushTargetGoneError({ platform: 'webpush', reason: '410' }));

		await expect(pushChannel({ onGone: vi.fn().mockRejectedValue(goneFailure) }).send(DELIVERY)).rejects.toBe(
			goneFailure,
		);
	});
});
