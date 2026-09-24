import type { MessengerMessage, MessengerResult } from '@novastarter/messenger';
import { MessengerDriverTelegram, type MessengerDriverTelegramConfig } from './driver.js';

/**
 * What {@link sendTelegram} takes: the bot and the message in one object.
 */
export type SendTelegramOptions = MessengerDriverTelegramConfig &
	Omit<MessengerMessage, 'to' | 'location'> & {
		/** The chat to send to. */
		chatId: string;
	};

/**
 * Send one Telegram message without registering anything: a driver made for the call, no manager, no events.
 *
 * For a script, a deploy hook, an alert to the team's chat — where wiring `useMessenger()` would be more than the
 * message. The application's messages go through `sendMessage()` of `@novastarter/messenger` instead, where the
 * `messenger.send` filter and the events see them.
 *
 * @param options - The token, the chat, and the message.
 * @returns The id of the message Telegram made, and its answer.
 * @throws MessengerTargetGoneError when the bot was blocked or the chat is gone.
 * @throws ProviderCallError when Telegram refused the message — its status and answer in `extensions`.
 * @throws Error when Telegram could not be reached.
 * @example
 * ```ts
 * await sendTelegram({ token: process.env.ALERTS_BOT_TOKEN!, chatId: '-1001234', text: 'Deploy finished' });
 * ```
 */
export const sendTelegram = async (options: SendTelegramOptions): Promise<MessengerResult> => {
	// The bot's options and the message's are one object here, so they are split for the driver
	const { token, apiUrl, timeout, defaultFormat, chatId, ...message } = options;

	return new MessengerDriverTelegram({ token, apiUrl, timeout, defaultFormat }).send({ ...message, to: chatId });
};
