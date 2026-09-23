import { useEmitter } from '@novastarter/emitter';
import { InvalidPayloadError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { toError } from '@novastarter/utils';
import { MessengerTargetGoneError } from '../errors/index.js';
import type { MessengerMessage, MessengerResult } from '../types.js';
import { useMessenger } from './use-messenger.js';

/**
 * Filter event a message passes through before it is sent; a handler may change it or return `null` to drop it.
 *
 * @defaultValue `messenger.send`
 */
export const MESSENGER_SEND_FILTER = 'messenger.send';

/**
 * Action event after the messenger accepted a message.
 *
 * @defaultValue `messenger.sent`
 */
export const MESSENGER_SENT_EVENT = 'messenger.sent';

/**
 * Action event when a location failed to send a message.
 *
 * @defaultValue `messenger.failed`
 */
export const MESSENGER_FAILED_EVENT = 'messenger.failed';

/**
 * Action event when the recipient can no longer be reached — blocked the bot, left the chat.
 *
 * @defaultValue `messenger.gone`
 */
export const MESSENGER_GONE_EVENT = 'messenger.gone';

/**
 * The location a message goes through when neither the call nor the message names one.
 *
 * @defaultValue `default`
 */
export const DEFAULT_MESSENGER_LOCATION = 'default';

/**
 * What {@link sendMessage} answers with: the driver's result and the location that sent it.
 */
export interface MessengerSendResult extends MessengerResult {
	/** The location that sent the message. */
	location: string;
}

/**
 * Per-call overrides of {@link sendMessage}.
 */
export interface MessengerSendOptions {
	/** Send through this location, ignoring the message's own. */
	location?: string | undefined;
}

/**
 * Send a message through a messenger location.
 *
 * The one entry point for outgoing messenger messages, on the `MessengerManager` of `useMessenger()`. What it does
 * for every message:
 *
 * 1. Refuses a message without a recipient, or without text and attachments.
 * 2. Runs the `messenger.send` filter, so the app can rewrite or drop it; the rewrite is checked the same way.
 * 3. Picks the location: the option, else the message's own, else `default`. There is no fallback chain — a chat id
 *    belongs to one bot.
 * 4. Sends, and emits `messenger.sent`, `messenger.gone` when the recipient is unreachable, or `messenger.failed` and
 *    throws.
 *
 * Limits of a messenger — text length, file size — are not checked here: the messenger refuses what it cannot take,
 * and its reason travels as the error's `cause`.
 *
 * @param message - The message.
 * @param options - Per-call overrides.
 * @returns The driver's result with the location, or `null` when a `messenger.send` filter dropped the message.
 * @throws InvalidPayloadError for a message without a recipient, or without text and attachments.
 * @throws MessengerTargetGoneError when the recipient can no longer be reached — forget the chat, do not retry.
 * @throws Error when the location does not exist, or the messenger refused or could not be reached, the driver's error
 * as `cause`.
 * @example
 * ```ts
 * await sendMessage({
 * 	to: chatId,
 * 	text: '*Invoice 1042* is paid',
 * 	format: 'markdown',
 * 	attachments: [{ kind: 'document', source: pdf, filename: 'invoice-1042.pdf' }],
 * });
 * ```
 */
export const sendMessage = async (
	message: MessengerMessage,
	options: MessengerSendOptions = {},
): Promise<MessengerSendResult | null> => {
	const manager = useMessenger();
	const logger = useLogger();

	// 1. The message is checked before any work is done, so a broken one never reaches a handler
	assertMessage(message);

	// 2. A filter handler may rewrite the message — a redirect to a test chat — or veto it; the rewrite is checked too
	const prepared = await useEmitter().emitFilter<MessengerMessage | null>(MESSENGER_SEND_FILTER, message, {});

	if (!prepared) return null;

	assertMessage(prepared);

	// 3. One location; a name nobody registered is a configuration mistake worth naming
	const location = options.location ?? prepared.location ?? DEFAULT_MESSENGER_LOCATION;

	if (!manager.hasLocation(location)) {
		throw new Error(`Messenger location "${location}" doesn't exist.`);
	}

	const driver = manager.location(location);

	// 4. One send, then `messenger.sent` with the recipient, so a listener can log without re-deriving it
	try {
		const result = await driver.send(prepared);
		const sent: MessengerSendResult = { ...result, location };

		useEmitter().emitAction(MESSENGER_SENT_EVENT, { location, to: prepared.to, messageId: result.messageId });

		return sent;
	} catch (error) {
		// 5. A gone recipient is not a failure to retry: reported as its own event and passed on as is
		if (error instanceof MessengerTargetGoneError) {
			logger.info(`Messenger recipient on "${location}" is gone (${error.extensions.reason}): ${prepared.to}`);
			useEmitter().emitAction(MESSENGER_GONE_EVENT, { location, to: prepared.to, reason: error.extensions.reason });

			throw error;
		}

		// 6. Anything else is the messenger refusing or being unreachable; the driver's error travels as the cause
		logger.warn(toError(error), `Messenger location "${location}" failed to send to ${prepared.to}`);
		useEmitter().emitAction(MESSENGER_FAILED_EVENT, { location, to: prepared.to });

		throw new Error(`Messenger location "${location}" failed to send`, { cause: error });
	}
};

/**
 * Refuse a message without a recipient, or with nothing to send.
 *
 * @param message - The message, as it came in or as a `messenger.send` handler rewrote it.
 * @throws InvalidPayloadError when `to` is blank, or there is neither text nor an attachment.
 * @internal
 */
const assertMessage = (message: MessengerMessage): void => {
	// 1. A recipient is the one thing every messenger needs
	if (typeof message.to !== 'string' || !message.to.trim()) {
		throw new InvalidPayloadError({ reason: 'The messenger message has no recipient' });
	}

	// 2. An empty message is refused by every messenger; refused here as the payload's fault
	const hasText = typeof message.text === 'string' && message.text.trim().length > 0;

	if (!hasText && !message.attachments?.length) {
		throw new InvalidPayloadError({ reason: 'The messenger message has no text and no attachments' });
	}
};
