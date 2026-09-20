import { useLogger } from '@novastarter/logger';
import type { Logger } from 'pino';
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
}
