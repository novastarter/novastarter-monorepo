import { type Logger, useLogger } from '@novastarter/logger';
import type { MessengerDriver } from '../../driver.js';
import type { MessengerMessage, MessengerResult } from '../../types.js';

/**
 * Options of {@link MessengerDriverConsole}.
 */
export type MessengerDriverConsoleConfig = {
	/** Logger to write to; the application logger unless given. */
	logger?: Logger | undefined;
};

/**
 * Driver that writes every message to the log instead of sending it.
 *
 * The zero-config transport: development and tests run on it without a bot. Nothing goes to the console directly —
 * the logger decides where lines end up.
 *
 * @example
 * ```ts
 * useMessenger().registerLocation('default', {
 * 	driver: 'console',
 * 	options: {},
 * });
 * ```
 */
export class MessengerDriverConsole implements MessengerDriver {
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
	constructor(config: MessengerDriverConsoleConfig = {}) {
		// 1. The application logger is resolved here, not at send time, so a swapped logger does not split one
		//    location's output across two destinations
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Log the message as if it were sent.
	 *
	 * @param message - The message.
	 * @returns A sequential id.
	 */
	async send(message: MessengerMessage): Promise<MessengerResult> {
		// 1. A counter stands in for the messenger's id, so a test can tell two sends apart
		this.sent += 1;

		const messageId = `console-${this.sent}`;

		const attachments = (message.attachments ?? []).map((attachment) => ({
			kind: attachment.kind,
			source: typeof attachment.source === 'string' ? attachment.source : (attachment.filename ?? 'blob'),
		}));

		// 2. One structured line per message, the text in it: what a developer reads; a file is named, not dumped
		this.logger.info(
			{ to: message.to, ...(attachments.length > 0 ? { attachments } : {}), messageId },
			`Messenger to ${message.to}: ${message.text ?? `${attachments.length} attachment(s)`}`,
		);

		return { messageId };
	}
}
