import { InvalidConfigError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, type HttpApi, request } from '@novastarter/http';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { Resend } from 'resend';
import { describeError } from './describe-error.js';
import { toResendEmail } from './to-resend-email.js';

/**
 * Options accepted by {@link MailDriverResend}.
 */
export type MailDriverResendConfig = {
	/** API key from the Resend dashboard (`re_…`). */
	apiKey: string;
};

/**
 * The root of Resend's REST API, which the paths of {@link MailDriverResend.call} are joined to.
 *
 * @internal
 */
const RESEND_API_URL = 'https://api.resend.com';

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `resend` has its options
 * checked against {@link MailDriverResendConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		resend: MailDriverResendConfig;
	}
}

/**
 * Driver for [Resend](https://resend.com).
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverResend } from '@novastarter/mail-driver-resend';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('resend', MailDriverResend);
 * mail.registerLocation('main', {
 * 	driver: 'resend',
 * 	options: {
 * 		apiKey: env.MAIL_RESEND_API_KEY,
 * 	},
 * });
 * ```
 */
export class MailDriverResend implements MailDriver {
	/**
	 * Resend's client, bound to the location's key.
	 *
	 * @internal
	 */
	private readonly client: Resend;

	/**
	 * Resend's REST API with the location's key as a bearer token, which {@link MailDriverResend.call} requests; no
	 * host besides the root's own, since Resend serves its whole API from one host.
	 *
	 * @internal
	 */
	private readonly api: HttpApi;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - API key.
	 * @throws InvalidConfigError without an API key.
	 */
	constructor(config: MailDriverResendConfig) {
		if (!config.apiKey) {
			throw new InvalidConfigError({ reason: 'The resend mail driver needs an "apiKey"' });
		}

		// Raw calls bypass the SDK, so the key goes to both
		this.client = new Resend(config.apiKey);

		this.api = {
			provider: 'resend',
			baseUrl: RESEND_API_URL,
			headers: { authorization: `Bearer ${config.apiKey}` },
		};
	}

	/**
	 * Send through the Resend API.
	 *
	 * @param message - Rendered message.
	 * @returns Resend's message id; every recipient as accepted, since the API takes all or nothing; `response`
	 * stays empty, since the API answers no status line.
	 * @throws Error naming Resend with the failure's `name` and `message`, the SDK's error value as the cause, when
	 * the API refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// The SDK answers `{ data, error }` instead of throwing, so a refusal has to be read off the value
		const { data, error } = await this.client.emails.send(await toResendEmail(message));

		// A failure becomes the throw the fallback of `sendMail()` expects, the SDK's value kept as the cause so the
		// caller can still read its status code
		if (error || !data) {
			throw describeError(error ?? 'no data or error returned');
		}

		// Resend takes a message whole or refuses it, so every recipient counts as accepted
		return {
			messageId: data.id,
			accepted: toMailAddressList(message.to).map(bareMailAddress),
			rejected: [],
		};
	}

	/**
	 * Make a request of Resend's REST API with the location's key — the way to domains, audiences, contacts, broadcasts
	 * and whatever else the driver has no wrapper for.
	 *
	 * The request goes over `fetch` rather than the SDK: the SDK's generic methods drop the query of a `GET`, answer
	 * refusals as values and swallow network errors, while here a refusal throws the kit's error. The parameters are the
	 * query of a `GET`, `HEAD` or `DELETE` and the JSON body otherwise.
	 *
	 * @typeParam T - What the endpoint answers with; the caller knows it from Resend's documentation.
	 * @param method - The verb and a path from `https://api.resend.com` (`GET /domains`), or a full URL on that host.
	 * @param params - Its query or body. A `{name}` in the path takes the parameter of that name, URL-encoded,
	 * which is then not sent again.
	 * @param options - A timeout over the default 30 s, an abort signal, extra headers.
	 * @returns The status, the lower-cased headers and Resend's answer: parsed JSON, else text; `undefined` when empty.
	 * @throws ProviderCallError when Resend answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Resend asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Resend's host.
	 * @example
	 * ```ts
	 * const { data } = await resend.call<{ data: { id: string; name: string }[] }>('GET /domains');
	 *
	 * const { data: domain } = await resend.call<{ id: string; status: string }>('GET /domains/{id}', {
	 * 	id: 'd91cd9bd-1176-453e-8fc1-35364d380206',
	 * });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: CallOptions,
	): Promise<CallResponse<T>> {
		return request<T>(this.api, method, params, options);
	}
}
