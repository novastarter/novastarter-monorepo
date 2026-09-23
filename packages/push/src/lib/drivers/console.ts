import { type Logger, useLogger } from '@novastarter/logger';
import type { CallOptions } from '@novastarter/utils';
import type { PushDriver } from '../../driver.js';
import { PUSH_PLATFORMS, type PushMessage, type PushPlatform, type PushResult } from '../../types.js';
import { platformOf } from '../platform-of.js';

/**
 * Options of {@link PushDriverConsole}.
 */
export type PushDriverConsoleConfig = {
	/** Logger to write to; the application logger unless given. */
	logger?: Logger | undefined;
};

/**
 * Driver that writes every message to the log instead of sending it.
 *
 * The zero-config transport: development and tests run on it without a push service. It takes every platform, so a
 * subscription and a token alike land in the log. Nothing goes to the console directly — the logger decides where
 * lines end up.
 *
 * @example
 * ```ts
 * usePush().registerLocation('default', {
 * 	driver: 'console',
 * 	options: {},
 * });
 * ```
 */
export class PushDriverConsole implements PushDriver {
	/**
	 * Every platform: the log can take a subscription and a token alike.
	 */
	readonly platforms: readonly PushPlatform[] = PUSH_PLATFORMS;

	/**
	 * Where the messages are written.
	 *
	 * @internal
	 */
	private readonly logger: Logger;

	/**
	 * Messages logged so far; the source of the sequential ids.
	 *
	 * @internal
	 */
	private sent = 0;

	/**
	 * Create a driver on the given logger, or on the application's.
	 *
	 * @param config - Logger.
	 */
	constructor(config: PushDriverConsoleConfig = {}) {
		// 1. The application logger is resolved here, not at send time, so a swapped logger does not split one
		//    location's output across two destinations
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Log the message as if it were sent.
	 *
	 * @param message - The message.
	 * @returns A sequential id and the status `logged`.
	 */
	async send(message: PushMessage): Promise<PushResult> {
		// 1. A counter stands in for the push service's id, so a test can tell two sends apart
		this.sent += 1;

		const messageId = `console-${this.sent}`;
		const platform = platformOf(message);
		const target = platform === 'webpush' ? message.subscription?.endpoint : message.token;

		// 2. One structured line per message, the text in it: what a developer reads
		this.logger.info(
			{
				platform,
				target,
				title: message.title,
				...(message.body !== undefined ? { body: message.body } : {}),
				...(message.url !== undefined ? { url: message.url } : {}),
				messageId,
			},
			`Push (${platform}) to ${target}: ${message.title}${message.body ? ` — ${message.body}` : ''}`,
		);

		return { messageId, status: 'logged' };
	}

	/**
	 * Log a request of the provider's API as if it were made.
	 *
	 * Lets code written against a provider's `call()` run in development without the provider; files are named, not
	 * dumped, and the options are left out of the line, since their headers may carry secrets.
	 *
	 * @typeParam T - What the caller expects back; there is no answer, so it gets `undefined`.
	 * @param method - The verb and path, or the command name.
	 * @param params - Its parameters.
	 * @param _options - Ignored: nothing is sent, so there is nothing to time out or add headers to.
	 * @returns `undefined`.
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, _options?: CallOptions): Promise<T> {
		// 1. A file stands for itself by its name, so the log line stays readable
		const logged = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, describeValue(value)]));

		// 2. One line per request, what a developer reads; nothing comes back, as no provider answered
		this.logger.info({ method, params: logged }, `Push call ${method}`);

		return undefined as T;
	}
}

/**
 * What the log shows for a parameter: a file by its name, anything else as it is.
 *
 * @param value - The parameter.
 * @returns The file's name, `blob` for a nameless one, or the value.
 * @internal
 */
const describeValue = (value: unknown): unknown => {
	// 1. A `File` has a name worth showing; a bare `Blob` only its kind
	if (value instanceof File) return value.name;
	if (value instanceof Blob) return 'blob';

	return value;
};
