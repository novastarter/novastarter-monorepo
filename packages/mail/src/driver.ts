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
