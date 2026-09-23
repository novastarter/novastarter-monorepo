import type { CallOptions } from '@novastarter/utils';
import type { MailMessage, MailResult } from './types.js';

/**
 * Contract every mail driver implements — the `StorageDriver` of `@novastarter/storage`, for mail.
 *
 * Declared as an ambient class rather than an interface so that `typeof MailDriver` describes a constructor for
 * {@link MailManager.registerDriver}; no runtime code exists behind it. The built-in drivers live in `lib/drivers/`,
 * vendor SDKs in `@novastarter/mail-driver-*` packages. The constructor takes the `options` of the location that names
 * the driver; the manager calls it on the location's first use.
 */
export declare class MailDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Deliver a message.
	 *
	 * @param message - Rendered message.
	 * @returns What the provider answered.
	 * @throws When the provider refuses the message or cannot be reached; `sendMail()` moves on to the next location.
	 */
	send(message: MailMessage): Promise<MailResult>;

	/**
	 * Make a request of the mail provider's own API with the location's credentials, timeout and errors — the way to
	 * whatever the contract does not cover, an endpoint the driver has no wrapper for yet included.
	 *
	 * The signature is the same for every driver; what `method` means is the provider's, so code calling it is written
	 * for one provider: the verb and path of a REST API — Resend's `GET /domains`, Postmark's `GET /bounces`; SES's
	 * command name `GetAccount` — a full URL on one of the provider's own hosts, or the command name of an RPC-style
	 * SDK. The parameters are the query of a `GET`, `HEAD` or `DELETE` and the body otherwise; a `Blob` or `File` among
	 * them is uploaded, where the API takes files.
	 *
	 * Optional: the `console` driver logs the request, while `smtp`, `sendmail` and `file` have no API and leave it
	 * out.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from the provider's documentation.
	 * @param method - The verb and path, a full URL on the provider's hosts, or a command name.
	 * @param params - Its query or body.
	 * @param options - A timeout, an abort signal, extra headers, and `paramsIn` — `body` for an API that reads a
	 * `DELETE` body.
	 * @returns The provider's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when the provider answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when the provider asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on the provider's hosts.
	 * @example
	 * ```ts
	 * await useMail().location('resend').call?.('GET /domains');
	 * ```
	 */
	call?<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T>;

	/**
	 * Check the transport can be used — credentials, connectivity — without sending.
	 *
	 * @throws When it cannot.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds — an SMTP connection pool, an SDK's HTTP agents — so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
