import { HitRateLimitError } from '@novastarter/errors';
import { MessengerTargetGoneError } from '@novastarter/messenger';

/**
 * What the Bot API answers a refused request with.
 */
export interface TelegramErrorAnswer {
	/** Always `false` on a refusal. */
	ok: false;
	/** The HTTP-like code: `400`, `403`, `429`. */
	error_code?: number | undefined;
	/** What went wrong, in Telegram's words: `Forbidden: bot was blocked by the user`. */
	description?: string | undefined;
	/** Extra data; `retry_after` in seconds on a 429. */
	parameters?: { retry_after?: number | undefined } | undefined;
}

/**
 * Descriptions of a `400` that mean the chat cannot be reached at all, rather than a broken request.
 *
 * @internal
 */
const GONE_DESCRIPTIONS = ['chat not found', 'user is deactivated', 'bot was kicked', 'group chat was deleted'];

/**
 * Turn a refusal of the Bot API into the error the kit speaks.
 *
 * - `403` (blocked, kicked, deactivated) and a `400` saying the chat is gone → `MessengerTargetGoneError`: the chat id
 *   is dead for this bot, forget it;
 * - `429` → `HitRateLimitError`, reset at `retry_after`; Telegram does not tell the limit, so it is `0`;
 * - anything else → `Error` with Telegram's description.
 *
 * @param method - The method that was called, for the message.
 * @param answer - What the Bot API answered.
 * @param status - The HTTP status, when the answer carries no `error_code`.
 * @returns The error to throw.
 */
export const toTelegramError = (method: string, answer: Partial<TelegramErrorAnswer>, status: number): Error => {
	// 1. The code of the answer wins over the HTTP status; they agree, but a proxy may rewrite the latter
	const code = answer.error_code ?? status;
	const description = answer.description ?? `HTTP ${status}`;

	// 2. The recipient is unreachable for good: not a failure to retry
	if (code === 403 || (code === 400 && GONE_DESCRIPTIONS.some((gone) => description.toLowerCase().includes(gone)))) {
		return new MessengerTargetGoneError({ reason: description });
	}

	// 3. Too many requests: the caller may try again after the wait Telegram names
	if (code === 429) {
		const retryAfter = answer.parameters?.retry_after ?? 1;

		return new HitRateLimitError({ limit: 0, reset: new Date(Date.now() + retryAfter * 1000) });
	}

	// 4. Everything else is Telegram's refusal of the request, told in its words; the token is never in the message
	return new Error(`Telegram refused ${method}: ${description}`);
};
