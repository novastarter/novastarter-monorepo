import { type CallOptions, type CallResponse, httpCall, toHeaderRecord } from '@novastarter/http';
import type { MessengerDriver, MessengerFormat, MessengerMessage, MessengerResult } from '@novastarter/messenger';
import { type TelegramErrorAnswer, toTelegramError } from './to-telegram-error.js';
import { toTelegramRequest } from './to-telegram-request.js';

/**
 * The Bot API server every call goes to unless another is given.
 *
 * @defaultValue `https://api.telegram.org`
 */
export const TELEGRAM_API_URL = 'https://api.telegram.org';

/**
 * How long a call may take before it is given up, in milliseconds: long enough for a file upload.
 *
 * @defaultValue 30 seconds.
 */
export const DEFAULT_TELEGRAM_TIMEOUT = 30_000;

/**
 * Options accepted by {@link MessengerDriverTelegram}.
 */
export type MessengerDriverTelegramConfig = {
	/** The bot's token from @BotFather: `<bot id>:<hash>`. */
	token: string;
	/** The Bot API server: a local one, or a fake in tests; {@link TELEGRAM_API_URL} unless given. */
	apiUrl?: string | undefined;
	/** How long a call may take, in milliseconds; {@link DEFAULT_TELEGRAM_TIMEOUT} unless given. */
	timeout?: number | undefined;
	/** The format of a message that names none; plain text unless given. */
	defaultFormat?: MessengerFormat | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/messenger`, so a location naming `telegram` has its
 * options checked against {@link MessengerDriverTelegramConfig}.
 */
declare module '@novastarter/messenger' {
	interface MessengerDrivers {
		telegram: MessengerDriverTelegramConfig;
	}
}

/**
 * What the Bot API answers an accepted call with.
 *
 * @internal
 */
interface TelegramAnswer<T> {
	ok: true;
	result: T;
}

/**
 * Messenger driver for Telegram, on the Bot API over `fetch`, without an SDK.
 *
 * `send()` turns a message into `sendMessage`, `sendPhoto`, `sendDocument` or `sendMediaGroup`. Every other method of
 * the Bot API — one this package does not know yet included — is reachable through {@link call}, with the same token,
 * timeout and errors: the API is one `POST /bot<token>/<method>` for all of them.
 *
 * @example
 * ```ts
 * messenger.registerDriver('telegram', MessengerDriverTelegram);
 * messenger.registerLocation('telegram', {
 * 	driver: 'telegram',
 * 	options: { token: env.TELEGRAM_BOT_TOKEN },
 * });
 *
 * // a method without a wrapper
 * await useMessenger().location('telegram').call?.('setMessageReaction', {
 * 	chat_id: chatId,
 * 	message_id: 7,
 * 	reaction: [{ type: 'emoji', emoji: '👍' }],
 * });
 * ```
 */
export class MessengerDriverTelegram implements MessengerDriver {
	/**
	 * The options the driver was built with, the defaults filled in.
	 *
	 * @internal
	 */
	private readonly config: {
		token: string;
		apiUrl: string;
		timeout: number;
		defaultFormat: MessengerFormat | undefined;
	};

	/**
	 * Create the driver from its location options.
	 *
	 * @param config - The token, and the server, timeout and format when not the defaults.
	 * @throws Error without a token, with a token that is not `<id>:<hash>`, or with an `apiUrl` that is not a URL.
	 */
	constructor(config: MessengerDriverTelegramConfig) {
		// 1. A missing token would only fail on the first message, far from the configuration that forgot it
		if (typeof config.token !== 'string' || config.token.length === 0) {
			throw new Error('The Telegram driver needs a bot "token"');
		}

		// 2. The token goes into the request URL raw, so one holding `#`, `?` or `/` would split the path and end as a
		//    confusing 404. A bot token is `<id>:<hash>`; anything else is refused here, at construction, and the value
		//    is left out of the message — it is a secret
		if (!/^\d+:[\w-]+$/.test(config.token)) {
			throw new Error('The Telegram driver\'s "token" is not a bot token of the shape "<id>:<hash>"');
		}

		// 3. A server that is not a URL is refused here, on its own: the URL a call builds holds the token, and the
		//    `TypeError` of an invalid one would carry it in its `input`. The value is left out of the message too
		const apiUrl = (config.apiUrl ?? TELEGRAM_API_URL).replace(/\/+$/, '');

		try {
			new URL(apiUrl);
		} catch {
			throw new Error('The Telegram driver\'s "apiUrl" is not a valid URL');
		}

		// 4. A trailing slash on the server, dropped above, would double up in every URL
		this.config = {
			token: config.token,
			apiUrl,
			timeout: config.timeout ?? DEFAULT_TELEGRAM_TIMEOUT,
			defaultFormat: config.defaultFormat,
		};
	}

	/**
	 * Send a message: text, one file, or an album.
	 *
	 * @param message - The message.
	 * @returns The id of the (first) message Telegram made, and its answer.
	 * @throws MessengerTargetGoneError when the bot was blocked or the chat is gone.
	 * @throws HitRateLimitError when Telegram asks to slow down.
	 * @throws Error when Telegram refused the message or could not be reached.
	 */
	async send(message: MessengerMessage): Promise<MessengerResult> {
		// 1. The method and its parameters, then the call
		const { method, params } = toTelegramRequest(message, this.config.defaultFormat);
		const { data: result } = await this.call<{ message_id?: number } | { message_id?: number }[]>(method, params);

		// 2. An album answers a list of messages; the first one stands for it
		const first = Array.isArray(result) ? result[0] : result;

		return { ...(first?.message_id !== undefined ? { messageId: String(first.message_id) } : {}), raw: result };
	}

	/**
	 * Check the token by asking Telegram who the bot is.
	 *
	 * @throws Error when the token is refused or Telegram cannot be reached.
	 */
	async verify(): Promise<void> {
		await this.call('getMe');
	}

	/**
	 * Call any method of the Bot API with the driver's token, timeout and errors.
	 *
	 * The way to a method the package has no wrapper for — a new one included. The parameters go as JSON; a `Blob` or
	 * `File` among them sends the call as multipart instead, the other values as text and objects as JSON strings, the
	 * way the Bot API reads a form.
	 *
	 * @typeParam T - What the method's `result` is; the caller knows it from Telegram's documentation.
	 * @param method - The method: `sendPhoto`, `setMessageReaction`.
	 * @param params - Its parameters; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers.
	 * @returns The HTTP status, the lower-cased headers and the `result` of Telegram's answer, without the
	 * `{ ok, result }` envelope.
	 * @throws MessengerTargetGoneError when the bot was blocked or the chat is gone.
	 * @throws HitRateLimitError when Telegram asks to slow down.
	 * @throws TimeoutError when the call takes longer than the timeout.
	 * @throws Error when Telegram refused the call or answered something that is not JSON.
	 * @example
	 * ```ts
	 * const { data } = await telegram.call<{ message_id: number }>('sendPhoto', {
	 * 	chat_id: chatId,
	 * 	photo: new File([png], 'chart.png'),
	 * 	caption: 'Today',
	 * });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options: CallOptions = {},
	): Promise<CallResponse<T>> {
		// 1. With a file among the parameters the call is multipart, and the Bot API reads every other field of a form
		//    as text: a number as its digits, an object — `media`, `reply_markup` — as its JSON. `httpCall()` would
		//    repeat a list's field instead, so the values are turned into text here; without a file it sends JSON as is
		const defined = Object.entries(params).filter(([, value]) => value !== undefined);
		const multipart = defined.some(([, value]) => value instanceof Blob);

		const body = multipart
			? Object.fromEntries(
					defined.map(([key, value]) => [
						key,
						value instanceof Blob || typeof value === 'string' ? value : JSON.stringify(value),
					]),
				)
			: Object.fromEntries(defined);

		// 2. One `POST /bot<token>/<method>`, its answer read under the same deadline; the method is encoded so it
		//    stays one path segment. The token is in the URL; `httpCall()` puts nothing of the request into an error
		const response = await httpCall({
			url: new URL(`${this.config.apiUrl}/bot${this.config.token}/${encodeURIComponent(method)}`),
			verb: 'POST',
			params: body,
			headers: options.headers,
			timeout: options.timeout ?? this.config.timeout,
			signal: options.signal,
		});

		// 3. Telegram answers JSON even on a refusal; anything else is a proxy or an outage in between
		const answer = response.body as TelegramAnswer<T> | TelegramErrorAnswer | undefined;

		if (typeof answer !== 'object' || answer === null || !('ok' in answer)) {
			throw new Error(`Telegram answered ${method} with HTTP ${response.status} and no JSON`);
		}

		// 4. A refusal becomes the kit's error for it; an accepted call answers its `result`, not the envelope
		if (!answer.ok) {
			throw toTelegramError(method, answer, response.status);
		}

		return { status: response.status, headers: toHeaderRecord(response.headers), data: answer.result };
	}
}
