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
	 */
	send(message: SmsMessage): Promise<SmsResult>;

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
