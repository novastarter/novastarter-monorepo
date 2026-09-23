/**
 * Tests of `notifications/lib/notifications` on fake channels; `@novastarter/emitter` is mocked.
 *
 * Covered: the channel registry, the plan (asked-for channels, reach, preferences, a missing user, an unknown channel)
 * and the delivery on one channel (every skip reason, the filter's rewrite, the events, a failing channel).
 */
import { useEmitter } from '@novastarter/emitter';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NotificationChannel, NotificationDelivery } from '../channel.js';
import type { Notification, NotificationRecipient } from '../types.js';
import {
	NOTIFICATION_FAILED_EVENT,
	NOTIFICATION_SEND_FILTER,
	NOTIFICATION_SENT_EVENT,
	Notifications,
	type NotificationsOptions,
} from './notifications.js';

vi.mock('@novastarter/emitter');

/**
 * Emitter double: the filter hands the notification back unchanged, the action only records.
 */
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * The notification every test sends.
 */
const NOTIFICATION: Notification = { type: 'invoice.paid', userId: 'u1', data: { invoice: '1042' } };

/**
 * A user with an address and no phone.
 */
const RECIPIENT: NotificationRecipient = { userId: 'u1', email: 'a@example.com' };

/**
 * A fake channel that reaches whoever `reachable` says and records what it delivers.
 *
 * @param name - The channel's name.
 * @param reachable - Whether a recipient is reached.
 * @returns The channel and its delivery spy.
 */
const fakeChannel = (
	name: string,
	reachable: (recipient: NotificationRecipient) => boolean = () => true,
): NotificationChannel & { send: ReturnType<typeof vi.fn> } => {
	// 1. A spy for `send`, so the tests can see what reached the transport
	return { name, reaches: reachable, send: vi.fn(async (_delivery: NotificationDelivery) => undefined) };
};

/**
 * Build the notifications over a mail-like and an SMS-like fake channel.
 *
 * @param overrides - Options to set on top of the defaults.
 * @returns The notifications and the two channels.
 */
const make = (overrides: Partial<NotificationsOptions> = {}) => {
	// 1. `mail` reaches an address, `sms` a phone — the recipient above has only the first
	const mail = fakeChannel('mail', (recipient) => Boolean(recipient.email));
	const sms = fakeChannel('sms', (recipient) => Boolean(recipient.phone));

	const notifications = new Notifications({
		channels: [mail, sms],
		findRecipient: async (userId) => (userId === 'u1' ? RECIPIENT : null),
		render: async (_notification, channel) => ({ text: `for ${channel}` }),
		...overrides,
	});

	return { notifications, mail, sms };
};

beforeEach(() => {
	vi.mocked(useEmitter).mockReturnValue(emitter as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('constructor', () => {
	test('Keeps the channels in order and refuses a duplicate name', () => {
		// 1. The registration order is the order of every plan
		expect(make().notifications.channelNames()).toStrictEqual(['mail', 'sms']);

		expect(
			() =>
				new Notifications({
					channels: [fakeChannel('mail'), fakeChannel('mail')],
					findRecipient: async () => null,
					render: async () => null,
				}),
		).toThrow('Notification channel "mail" is registered twice');
	});
});

describe('plan', () => {
	test('Picks the channels that reach the user and that the user wants', async () => {
		// 1. No phone: `sms` is left out
		await expect(make().notifications.plan(NOTIFICATION)).resolves.toStrictEqual(['mail']);

		// 2. A preference turns `mail` off too
		const isEnabled = vi.fn(async (_userId: string, _type: string, channel: string) => channel !== 'mail');

		await expect(make({ isEnabled }).notifications.plan(NOTIFICATION)).resolves.toStrictEqual([]);
		expect(isEnabled).toHaveBeenCalledWith('u1', 'invoice.paid', 'mail');
	});

	test('Keeps to the channels the notification asks for, in registration order', async () => {
		const { notifications } = make({
			findRecipient: async () => ({ userId: 'u1', email: 'a@example.com', phone: '+15555550100' }),
		});

		// 1. Asked in another order, answered in the registered one
		await expect(notifications.plan({ ...NOTIFICATION, channels: ['sms', 'mail'] })).resolves.toStrictEqual([
			'mail',
			'sms',
		]);

		await expect(notifications.plan({ ...NOTIFICATION, channels: ['sms'] })).resolves.toStrictEqual(['sms']);
	});

	test('Plans nothing for a missing user, and refuses an unknown channel or a broken notification', async () => {
		const { notifications } = make();

		// 1. A user deleted since is not an error
		await expect(notifications.plan({ ...NOTIFICATION, userId: 'gone' })).resolves.toStrictEqual([]);

		// 2. A channel nobody registered, or no type, is a mistake of the calling code
		await expect(notifications.plan({ ...NOTIFICATION, channels: ['fax'] })).rejects.toThrow(
			'Notification channel "fax" isn\'t registered',
		);

		await expect(notifications.plan({ ...NOTIFICATION, type: '' })).rejects.toThrow();
	});
});

describe('send', () => {
	test('Delivers the rendered content and announces it', async () => {
		const { notifications, mail } = make();

		// 1. The channel gets the notification, the recipient and the content of `render`
		await expect(notifications.send(NOTIFICATION, { channel: 'mail' })).resolves.toStrictEqual({ status: 'sent' });

		expect(mail.send).toHaveBeenCalledWith({
			notification: NOTIFICATION,
			recipient: RECIPIENT,
			content: { text: 'for mail' },
		});

		expect(emitter.emitFilter).toHaveBeenCalledWith(NOTIFICATION_SEND_FILTER, NOTIFICATION, { channel: 'mail' });

		expect(emitter.emitAction).toHaveBeenCalledWith(NOTIFICATION_SENT_EVENT, {
			channel: 'mail',
			payload: NOTIFICATION,
		});
	});

	test('Delivers what the filter rewrote, and nothing when it dropped the notification', async () => {
		const { notifications, mail } = make();

		// 1. A rewrite goes through as rewritten
		emitter.emitFilter.mockResolvedValueOnce({ ...NOTIFICATION, data: { invoice: '9' } });

		await notifications.send(NOTIFICATION, { channel: 'mail' });

		expect(mail.send.mock.calls[0]![0].notification.data).toStrictEqual({ invoice: '9' });

		// 2. A drop is a skip, not a failure
		emitter.emitFilter.mockResolvedValueOnce(null);

		await expect(notifications.send(NOTIFICATION, { channel: 'mail' })).resolves.toStrictEqual({
			status: 'skipped',
			reason: 'filter',
		});
	});

	test('Skips a missing user, an unreachable one, a turned-off channel and a channel without content', async () => {
		// 1. Each reason read at delivery time; none of them throws, so the job does not retry
		await expect(
			make().notifications.send({ ...NOTIFICATION, userId: 'gone' }, { channel: 'mail' }),
		).resolves.toStrictEqual({ status: 'skipped', reason: 'recipient' });

		await expect(make().notifications.send(NOTIFICATION, { channel: 'sms' })).resolves.toStrictEqual({
			status: 'skipped',
			reason: 'unreachable',
		});

		await expect(
			make({ isEnabled: async () => false }).notifications.send(NOTIFICATION, { channel: 'mail' }),
		).resolves.toStrictEqual({ status: 'skipped', reason: 'preference' });

		await expect(
			make({ render: async () => null }).notifications.send(NOTIFICATION, { channel: 'mail' }),
		).resolves.toStrictEqual({ status: 'skipped', reason: 'content' });
	});

	test('Announces and rethrows a failing channel, and refuses an unknown one', async () => {
		const { notifications, mail } = make();
		const failure = new Error('smtp down');

		mail.send.mockRejectedValueOnce(failure);

		// 1. The job gets the channel's own error to retry on
		await expect(notifications.send(NOTIFICATION, { channel: 'mail' })).rejects.toBe(failure);

		expect(emitter.emitAction).toHaveBeenCalledWith(NOTIFICATION_FAILED_EVENT, {
			channel: 'mail',
			payload: NOTIFICATION,
			error: failure,
		});

		// 2. A channel nobody registered is a mistake, not a skip
		await expect(notifications.send(NOTIFICATION, { channel: 'fax' })).rejects.toThrow(
			'Notification channel "fax" isn\'t registered',
		);
	});
});
