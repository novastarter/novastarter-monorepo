/**
 * Tests of `notifications/lib/channels/push`; `sendPush` of `@novastarter/push` is mocked, its error class is real.
 */
import { PushTargetGoneError, sendPush } from '@novastarter/push';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NotificationRecipient, PushTarget } from '../../types.js';
import { pushChannel } from './push.js';

vi.mock('@novastarter/push', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@novastarter/push')>();

	// Only the transport is faked, so `instanceof PushTargetGoneError` is the real check
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
		expect(pushChannel().reaches(RECIPIENT)).toBe(true);
		expect(pushChannel().reaches({ userId: 'u1', pushTargets: [] })).toBe(false);
		expect(pushChannel().reaches({ userId: 'u1' })).toBe(false);
	});

	test('Sends the message to every device', async () => {
		await pushChannel().send(DELIVERY);

		expect(sendPush).toHaveBeenCalledTimes(2);
		expect(sendPush).toHaveBeenNthCalledWith(1, { title: 'Invoice paid', tag: 'invoice-1042', ...BROWSER });
		expect(sendPush).toHaveBeenNthCalledWith(2, { title: 'Invoice paid', tag: 'invoice-1042', ...PHONE });
	});

	test('Hands a gone device to onGone without failing', async () => {
		const onGone = vi.fn(async () => undefined);

		vi.mocked(sendPush).mockRejectedValueOnce(new PushTargetGoneError({ platform: 'webpush', reason: '410' }));

		await expect(pushChannel({ onGone }).send(DELIVERY)).resolves.toBeUndefined();

		expect(onGone).toHaveBeenCalledWith(BROWSER, 'u1');
		expect(sendPush).toHaveBeenCalledTimes(2);
	});

	test('Tries every device and then throws the first failure', async () => {
		const failure = new Error('push service down');

		vi.mocked(sendPush).mockRejectedValueOnce(failure);

		await expect(pushChannel().send(DELIVERY)).rejects.toBe(failure);

		expect(sendPush).toHaveBeenCalledTimes(2);
	});

	test('Drops a target the content carries, so the template cannot redirect the message', async () => {
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

		vi.mocked(sendPush)
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(new PushTargetGoneError({ platform: 'fcm', reason: '404' }));

		await expect(pushChannel({ onGone }).send(DELIVERY)).rejects.toBe(failure);
		expect(onGone).toHaveBeenCalledWith(PHONE, 'u1');

		// A failing `onGone` is thrown, so the job retries the clean-up
		const goneFailure = new Error('database down');

		vi.mocked(sendPush).mockRejectedValueOnce(new PushTargetGoneError({ platform: 'webpush', reason: '410' }));

		await expect(pushChannel({ onGone: vi.fn().mockRejectedValue(goneFailure) }).send(DELIVERY)).rejects.toBe(
			goneFailure,
		);
	});
});
