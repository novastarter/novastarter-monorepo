import type { CallOptions, CallResponse } from '@novastarter/http';
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
	 * Make a request of the messenger's own API with the location's credentials, timeout and errors — the way to
	 * whatever the contract does not cover, an endpoint the driver has no wrapper for yet included.
	 *
	 * The signature is the same for every driver; what `method` means is the provider's: the verb and path of a REST
	 * API — Telegram's `sendPhoto`, Discord's `POST /channels/{id}/messages` — a full URL on one of the provider's own
	 * hosts, or the command name of an RPC-style SDK. A `{name}` in the path is filled from the parameter of that name;
	 * the other parameters are the query of a `GET`, `HEAD` or `DELETE` and the body otherwise — JSON, a form or
	 * multipart as the `content-type` header and the files among them say. Headers and a timeout for every call of a
	 * location go in its registration's `call`.
	 *
	 * The `console` driver logs the request.
	 *
	 * @typeParam T - What the provider's body is; the caller knows it from the provider's documentation.
	 * @param method - The verb and path, a full URL on the provider's hosts, or a command name.
	 * @param params - The placeholders' values, and the query or body.
	 * @param options - A timeout, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and the body: parsed JSON, else text.
	 * @throws ProviderCallError when the provider answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when the provider asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, a placeholder is unfilled, or a URL is not on the provider's hosts.
	 * @example
	 * ```ts
	 * const driver = useMessenger().location('telegram');
	 * const { status, headers, data } = await driver.call!('sendPhoto', { chat_id: chatId, photo: file });
	 * ```
	 */
	call?<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<CallResponse<T>>;

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
