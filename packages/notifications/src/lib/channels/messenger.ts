import { type MessengerMessage, MessengerTargetGoneError, sendMessage } from '@novastarter/messenger';
import type { NotificationChannel, NotificationDelivery } from '../../channel.js';
import type { MessengerContent, NotificationRecipient } from '../../types.js';

/**
 * Options of {@link messengerChannel}.
 */
export interface MessengerChannelOptions {
	/** The messenger location to send through: `telegram`. */
	location: string;
	/** The channel's name, for notifications, preferences and `render`; the location's unless given. */
	name?: string | undefined;
	/**
	 * Forget a chat the messenger says is gone — the user blocked the bot, left the chat — so it is not tried again.
	 * Without it the dead chat stays, and every notification tries it once more.
	 */
	onGone?: ((location: string, chatId: string, userId: string) => Promise<void>) | undefined;
}

/**
 * A messenger channel: the rendered message to the user's chat on one messenger location, through `sendMessage()` of
 * `@novastarter/messenger`.
 *
 * One channel per location, so preferences and templates tell Telegram from another messenger; the chat comes from
 * `recipient.messengers[location]`, which the application fills in once the user linked the bot.
 *
 * @param options - The location, the channel's name, and what to do with a gone chat.
 * @returns The channel, named after the location unless named otherwise.
 * @example
 * ```ts
 * registerNotifications({
 * 	channels: [messengerChannel({ location: 'telegram', onGone: (_location, chatId) => unlinkTelegram(chatId) })],
 * 	findRecipient,
 * 	render,
 * });
 * ```
 */
export const messengerChannel = (options: MessengerChannelOptions): NotificationChannel<MessengerContent> => ({
	name: options.name ?? options.location,

	/**
	 * Whether the user linked a chat on the location.
	 *
	 * @param recipient - Where the user can be reached.
	 * @returns `true` with a chat id for the location.
	 */
	reaches(recipient: NotificationRecipient): boolean {
		return Boolean(recipient.messengers?.[options.location]);
	},

	/**
	 * Send the message to the user's chat.
	 *
	 * @param delivery - The recipient and the rendered message.
	 * @returns Once the messenger took it, or the chat was found gone and forgotten.
	 * @throws What `sendMessage()` throws when the messenger failed, or what `onGone` throws.
	 */
	async send({ recipient, content }: NotificationDelivery<MessengerContent>): Promise<void> {
		// 1. The chat and the location are the channel's to fill in, whatever the content carries
		const chatId = recipient.messengers![options.location]!;
		const { to: _to, location: _location, ...message } = content as MessengerMessage;

		try {
			await sendMessage({ ...message, to: chatId }, { location: options.location });
		} catch (error) {
			// 2. A gone chat is forgotten, not retried; any other failure goes to the job
			if (!(error instanceof MessengerTargetGoneError)) {
				throw error;
			}

			await options.onGone?.(options.location, chatId, recipient.userId);
		}
	},
});
