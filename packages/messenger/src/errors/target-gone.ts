import { createError, type NovastarterErrorConstructor } from '@novastarter/errors';

/**
 * Context of {@link MessengerTargetGoneError}.
 */
export interface MessengerTargetGoneErrorExtensions {
	/** What the messenger said: `Forbidden: bot was blocked by the user`, `Bad Request: chat not found`. */
	reason: string;
}

/**
 * Thrown by a driver when the recipient can no longer be reached: the person blocked the bot, left or deleted the
 * chat, or removed the bot from the group.
 *
 * Not a failure to retry — the stored chat id is dead for this bot and the caller forgets it. Status 410, like
 * `PushTargetGoneError`.
 *
 * @example
 * ```ts
 * try {
 * 	await sendMessage({ to: chatId, text: 'Hi' });
 * } catch (error) {
 * 	if (error instanceof MessengerTargetGoneError) await forgetChat(chatId);
 * }
 * ```
 */
export const MessengerTargetGoneError: NovastarterErrorConstructor<MessengerTargetGoneErrorExtensions> =
	createError<MessengerTargetGoneErrorExtensions>(
		'MESSENGER_TARGET_GONE',
		({ reason }) => `The messenger recipient is gone: ${reason}`,
		410,
	);
