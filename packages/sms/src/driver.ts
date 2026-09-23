import type { CallOptions, CallResponse } from '@novastarter/http';
import type { SmsMessage, SmsResult } from './types.js';

/**
 * Contract every SMS driver implements — the `MailDriver` of `@novastarter/mail`, for text messages.
 *
 * Declared as an ambient class rather than an interface so that `typeof SmsDriver` describes a constructor for
 * {@link SmsManager.registerDriver}; no runtime code exists behind it. The built-in driver lives in `lib/drivers/`,
 * vendor SDKs in `@novastarter/sms-driver-*` packages. The constructor takes the `options` of the location that names
 * the driver; the manager calls it on the location's first use.
 */
export declare class SmsDriver {
	/**
	 * Create a driver from its location options.
	 *
	 * @param config - Driver-specific options, as given in the location's `options`.
	 */
	constructor(config: Record<string, unknown>);

	/**
	 * Deliver a message.
	 *
	 * @param message - Message with its recipient normalised to E.164.
	 * @returns What the provider answered.
	 * @throws When the provider refuses the message or cannot be reached; `sendSms()` moves on to the next location.
	 * The one exception: an error carrying the code `SMS_PARTIAL_DELIVERY` of `@novastarter/sms` — a partial delivery,
	 * some parts accepted and billed — which `sendSms()` rethrows as-is, since the next location would send the
	 * delivered parts again.
	 */
	send(message: SmsMessage): Promise<SmsResult>;

	/**
	 * Make a request of the SMS provider's own API with the location's credentials, timeout and errors — the way to
	 * whatever the contract does not cover, an endpoint the driver has no wrapper for yet included.
	 *
	 * The signature is the same for every driver; what `method` means is the provider's: the verb and path of a REST
	 * API — Vonage's `GET /account/get-balance` — a full URL on one of the provider's own hosts, or the command name of
	 * an RPC-style SDK. A `{name}` in the path is filled from the parameter of that name; the other parameters are the
	 * query of a `GET`, `HEAD` or `DELETE` and the body otherwise — JSON, a form or multipart as the `content-type`
	 * header and the files among them say. Headers and a timeout for every call of a location go in its registration's
	 * `call`.
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
	 * const driver = useSms().location('twilio');
	 * const { status, headers, data } = await driver.call!('GET https://lookups.twilio.com/v2/PhoneNumbers/{number}', {
	 * 	number: '+15558675310',
	 * });
	 * ```
	 */

	call?<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<CallResponse<T>>;

	/**
	 * Check the transport can be used — credentials, connectivity — without sending.
	 *
	 * @throws When it cannot.
	 */
	verify?(): Promise<void>;

	/**
	 * Release what the driver holds — an SDK's HTTP agents — so the process can exit.
	 *
	 * Optional: a driver that only makes HTTP requests has nothing to release. The manager calls it at shutdown.
	 *
	 * @returns Once the connections are closed.
	 */
	close?(): Promise<void>;
}
