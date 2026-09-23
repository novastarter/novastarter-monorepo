import type { MessengerDriver, MessengerFormat, MessengerMessage, MessengerResult } from '@novastarter/messenger';
import { withTimeout } from '@novastarter/utils';
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
	/** The bot's token, from @BotFather. */
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
	 * @throws Error without a token.
	 */
	constructor(config: MessengerDriverTelegramConfig) {
		// 1. A missing token would only fail on the first message, far from the configuration that forgot it
		if (typeof config.token !== 'string' || config.token.length === 0) {
			throw new Error('The Telegram driver needs a bot "token"');
		}

		// 2. A trailing slash on the server would double up in every URL
		this.config = {
			token: config.token,
			apiUrl: (config.apiUrl ?? TELEGRAM_API_URL).replace(/\/+$/, ''),
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
		const result = await this.call<{ message_id?: number } | { message_id?: number }[]>(method, params);

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
	 * @returns The `result` of Telegram's answer.
	 * @throws MessengerTargetGoneError when the bot was blocked or the chat is gone.
	 * @throws HitRateLimitError when Telegram asks to slow down.
	 * @throws TimeoutError when the call takes longer than the timeout.
	 * @throws Error when Telegram refused the call or answered something that is not JSON.
	 * @example
	 * ```ts
	 * await telegram.call('sendPhoto', { chat_id: chatId, photo: new File([png], 'chart.png'), caption: 'Today' });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		// 1. JSON unless a file is among the parameters: the Bot API takes files only in a form
		const defined = Object.entries(params).filter(([, value]) => value !== undefined);
		const multipart = defined.some(([, value]) => value instanceof Blob);
		const body = multipart ? toFormData(defined) : JSON.stringify(Object.fromEntries(defined));

		// 2. The call, abandoned at the timeout; the token is in the URL, so the URL never goes into an error
		const response = await withTimeout(
			(signal) =>
				fetch(`${this.config.apiUrl}/bot${this.config.token}/${method}`, {
					method: 'POST',
					body,
					signal,
					...(multipart ? {} : { headers: { 'content-type': 'application/json' } }),
				}),
			this.config.timeout,
		);

		// 3. Telegram answers JSON even on a refusal; anything else is a proxy or an outage in between
		let answer: TelegramAnswer<T> | TelegramErrorAnswer;

		try {
			answer = (await response.json()) as TelegramAnswer<T> | TelegramErrorAnswer;
		} catch {
			throw new Error(`Telegram answered ${method} with HTTP ${response.status} and no JSON`);
		}

		// 4. A refusal becomes the kit's error for it
		if (!answer.ok) {
			throw toTelegramError(method, answer, response.status);
		}

		return answer.result;
	}
}

/**
 * Build the form of a multipart call.
 *
 * @param entries - The defined parameters.
 * @returns The form: files as files, strings as they are, everything else as JSON.
 * @internal
 */
const toFormData = (entries: [string, unknown][]): FormData => {
	const form = new FormData();

	// 1. The Bot API reads a form field as text, so a number is its digits and an object — `media`, `reply_markup` —
	//    its JSON
	for (const [key, value] of entries) {
		if (value instanceof Blob) {
			form.append(key, value, value instanceof File ? value.name : key);
		} else {
			form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
		}
	}

	return form;
};
