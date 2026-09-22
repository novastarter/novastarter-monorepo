import { type Logger, useLogger } from '@novastarter/logger';
import type { SmsDriver } from '../../driver.js';
import type { SmsMessage, SmsResult } from '../../types.js';

/**
 * Options of {@link SmsDriverConsole}.
 */
export type SmsDriverConsoleConfig = {
	/** Logger to write to; the application logger unless given. */
	logger?: Logger | undefined;
};

/**
 * Driver that writes every message to the log instead of sending it.
 *
 * The zero-config transport: a fresh clone signs in with one-time codes readable in the terminal. Nothing goes to the
 * console directly — the logger decides where lines end up.
 *
 * @example
 * ```ts
 * useSms().registerLocation('default', {
 * 	driver: 'console',
 * 	options: {},
 * });
 * ```
 */
export class SmsDriverConsole implements SmsDriver {
	/**
	 * Where the messages are written.
	 *
	 * @internal
	 */
	private readonly logger: Logger;

	/**
	 * Create a driver on the given logger, or on the application's.
	 *
	 * @param config - Logger.
	 */
	constructor(config: SmsDriverConsoleConfig = {}) {
		// 1. The application logger is resolved here, not at send time, so a swapped logger does not split one
		//    location's output across two destinations
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Log the message.
	 *
	 * @param message - Message to send.
	 * @returns A `logged` status; there is no provider to answer anything else.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// 1. The text is what a developer reads — the one-time code is in it; the optional fields join only when set
		this.logger.info(
			{
				to: message.to,
				...(message.from !== undefined ? { from: message.from } : {}),
				...(message.category ? { category: message.category } : {}),
				text: message.text,
			},
			`SMS: ${message.to}`,
		);

		return { status: 'logged' };
	}
}
