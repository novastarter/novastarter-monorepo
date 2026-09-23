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
	 * Make a request of the messenger's own API, with the location's credentials, timeout and errors — the way to
	 * whatever `send()` does not cover, a method the driver has no wrapper for yet included.
	 *
	 * The signature is the same for every driver; what `method` and `params` mean is the messenger's, so code calling
	 * it is written for one messenger: a method name of an RPC-style API — Telegram's `sendPhoto`, Slack's
	 * `chat.postMessage` — or the verb and path of a REST one — Discord's `POST /channels/123/messages`. A `Blob` or
	 * `File` among the parameters is uploaded, where the API takes files.
	 *
	 * Optional: a driver whose messenger has no API to reach may leave it out; the `console` driver logs the request.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from the messenger's documentation.
	 * @param method - The method, or the verb and path, in the messenger's terms.
	 * @param params - Its parameters or body.
	 * @returns The messenger's answer to the request.
	 * @throws MessengerTargetGoneError when the recipient can no longer be reached.
	 * @throws Error when the messenger refused the request or could not be reached.
	 * @example
	 * ```ts
	 * await useMessenger().location('telegram').call?.('sendPhoto', { chat_id: chatId, photo: file });
	 * ```
	 */
	call?<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

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
