/**
 * Tests of `notifications/lib/channels/messenger`; `sendMessage` of `@novastarter/messenger` is mocked, its error
 * class is real.
 */
import { MessengerTargetGoneError, sendMessage } from '@novastarter/messenger';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NotificationRecipient } from '../../types.js';
import { messengerChannel } from './messenger.js';

vi.mock('@novastarter/messenger', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@novastarter/messenger')>();

	// Only the transport is faked, so `instanceof MessengerTargetGoneError` is the real check
	return { ...actual, sendMessage: vi.fn(async () => null) };
});

/**
 * A user who linked Telegram.
 */
const RECIPIENT: NotificationRecipient = { userId: 'u1', messengers: { telegram: '123' } };

/**
 * One delivery of a paid invoice to {@link RECIPIENT}.
 */
const DELIVERY = {
	notification: { type: 'invoice.paid', userId: 'u1' },
	recipient: RECIPIENT,
	content: { text: '*Paid*', format: 'markdown' as const },
};

afterEach(() => {
	vi.clearAllMocks();
});

describe('messengerChannel', () => {
	test('Is named after its location unless named otherwise, and reaches a user with a chat there', () => {
		// The name is what preferences and `render` see
		expect(messengerChannel({ location: 'telegram' }).name).toBe('telegram');
		expect(messengerChannel({ location: 'telegram', name: 'tg' }).name).toBe('tg');

		expect(messengerChannel({ location: 'telegram' }).reaches(RECIPIENT)).toBe(true);
		expect(messengerChannel({ location: 'slack' }).reaches(RECIPIENT)).toBe(false);
		expect(messengerChannel({ location: 'telegram' }).reaches({ userId: 'u1' })).toBe(false);
	});

	test('Sends the content to the user’s chat through the location, whatever the content says', async () => {
		await messengerChannel({ location: 'telegram' }).send({
			...DELIVERY,
			content: { ...DELIVERY.content, to: 'evil', location: 'other' } as never,
		});

		expect(sendMessage).toHaveBeenCalledWith(
			{ text: '*Paid*', format: 'markdown', to: '123' },
			{ location: 'telegram' },
		);
	});

	test('Hands a gone chat to onGone without failing, and passes other failures on', async () => {
		const onGone = vi.fn(async () => undefined);

		vi.mocked(sendMessage).mockRejectedValueOnce(new MessengerTargetGoneError({ reason: 'blocked' }));

		await expect(messengerChannel({ location: 'telegram', onGone }).send(DELIVERY)).resolves.toBeUndefined();
		expect(onGone).toHaveBeenCalledWith('telegram', '123', 'u1');

		const failure = new Error('down');

		vi.mocked(sendMessage).mockRejectedValueOnce(failure);

		await expect(messengerChannel({ location: 'telegram', onGone }).send(DELIVERY)).rejects.toBe(failure);
	});
});
