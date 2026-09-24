import type { CallOptions, CallResponse } from '@novastarter/http';
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
		// Resolved here, not at send time, so a swapped logger does not split one location's output across two
		// destinations.
		this.logger = config.logger ?? useLogger();
	}

	/**
	 * Log the message.
	 *
	 * @param message - Message to send.
	 * @returns A `logged` status; there is no provider to answer anything else.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// The text is what a developer reads, since the one-time code is in it.
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
		// A file stands for itself by its name, so the log line stays readable.
		const logged = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, describeValue(value)]));

		// A plain 200 comes back, as no provider answered, so code reading the status runs too.
		this.logger.info({ method, params: logged }, `Sms call ${method}`);

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
	if (value instanceof File) return value.name;
	if (value instanceof Blob) return 'blob';

	return value;
};
