import type { MessengerMessage, MessengerResult } from './types.js';

/**
 * Contract every messenger driver implements.
 *
 * Declared as an ambient class rather than an interface so that `typeof MessengerDriver` describes a constructor for
 * `MessengerManager.registerDriver`; no runtime code exists behind it. The drivers of the messengers live in the
 * `@novastarter/messenger-driver-*` packages; one location is one bot or one workspace, with its token.
 */
export declare class MessengerDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Send a message: text, attachments, or both.
	 *
	 * @param message - The message.
	 * @returns The messenger's id of the message and its answer.
	 * @throws MessengerTargetGoneError when the recipient can no longer be reached — the bot was blocked or removed.
	 * @throws Error when the messenger refused the message or could not be reached.
	 */
	send(message: MessengerMessage): Promise<MessengerResult>;

	/**
	 * Check the driver can be used — the token, connectivity — without sending anything.
	 *
	 * @throws When it cannot.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds, so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
