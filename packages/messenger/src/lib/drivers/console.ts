import type { CallOptions, CallResponse } from '@novastarter/http';
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

	/**
	 * Log a request of the provider's API as if it were made.
	 *
	 * Lets code written against a provider's `call()` run in development without the provider; files are named, not
	 * dumped, and the options are left out of the line, since their headers may carry secrets.
	 *
	 * @typeParam T - What the caller expects back; there is no answer, so its `data` is `undefined`.
	 * @param method - The verb and path, or the command name.
	 * @param params - Its parameters.
	 * @param _options - Ignored: nothing is sent, so there is nothing to time out or add headers to.
	 * @returns A `200` with no headers and no body, as no provider answered.
	 */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		_options?: CallOptions,
	): Promise<CallResponse<T>> {
		// 1. A file stands for itself by its name, so the log line stays readable
		const logged = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, describeValue(value)]));

		// 2. One line per request, what a developer reads; a plain 200 comes back, as no provider answered, so code
		//    reading the status runs too
		this.logger.info({ method, params: logged }, `Messenger call ${method}`);

		return { status: 200, headers: {}, data: undefined as T };
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
