import { toProviderCallError } from '@novastarter/errors';
import {
	bareMailAddress,
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailAddressList,
} from '@novastarter/mail';
import { type CallOptions, parseCallMethod } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
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
 * How long a {@link MailDriverResend.call} request may take when the caller names no timeout, in milliseconds.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_RESEND_CALL_TIMEOUT = 30_000;

/**
 * The root of Resend's REST API, which the paths of {@link MailDriverResend.call} are joined to.
 *
 * @internal
 */
const RESEND_API_URL = 'https://api.resend.com';

/**
 * The hosts a full URL given to {@link MailDriverResend.call} may point at, besides the API root's own: none, since
 * Resend serves its whole API from one host.
 *
 * @internal
 */
const RESEND_CALL_HOSTS: readonly string[] = [];

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
	 * The location's API key, kept for the `Authorization` header of {@link MailDriverResend.call}.
	 *
	 * @internal
	 */
	private readonly apiKey: string;

	/**
	 * Create a driver on a client of its own for the given key.
	 *
	 * @param config - API key.
	 * @throws Error without an API key.
	 */
	constructor(config: MailDriverResendConfig) {
		// 1. A missing key is a configuration error; report it by the option's name
		if (!config.apiKey) {
			throw new Error('The resend mail driver needs an "apiKey"');
		}

		// 2. The key goes to the SDK for sending and is kept for raw calls, which bypass the SDK
		this.apiKey = config.apiKey;
		this.client = new Resend(config.apiKey);
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
		// 1. The SDK answers `{ data, error }` instead of throwing, so a refusal has to be read off the value;
		//    attachments are read into the payload before the request goes out
		const { data, error } = await this.client.emails.send(await toResendEmail(message));

		// 2. A failure becomes the throw the fallback of `sendMail()` expects, the SDK's value kept as the cause so
		//    the caller can still read its status code; a missing value is named for what it is
		if (error || !data) {
			throw describeError(error ?? 'no data or error returned');
		}

		// 3. Resend takes a message whole or refuses it, so every recipient counts as accepted
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
	 * @param params - Its query or body.
	 * @param options - A timeout over the default 30 s, an abort signal, extra headers, where the parameters go
	 * (`paramsIn`).
	 * @returns Resend's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Resend answers with an error status — its status and answer in `extensions`.
	 * @throws HitRateLimitError when Resend asks to slow down.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed or its URL is not on Resend's host.
	 * @example
	 * ```ts
	 * const domains = await resend.call<{ data: { id: string; name: string }[] }>('GET /domains');
	 *
	 * const domain = await resend.call<{ id: string; status: string }>(
	 * 	'GET /domains/d91cd9bd-1176-453e-8fc1-35364d380206',
	 * );
	 * ```
	 */
	async call<T = unknown>(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
		// 1. The verb and the URL, checked before any request so the key never travels to a host other than Resend's
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(RESEND_API_URL, target, RESEND_CALL_HOSTS);

		// 2. The request with the key as a bearer token, the caller's headers on top, under the deadline
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: `Bearer ${this.apiKey}`, ...options.headers },
			timeout: options.timeout ?? DEFAULT_RESEND_CALL_TIMEOUT,
			signal: options.signal,
		});

		// 3. A non-2xx answer becomes the kit's error; it carries the method and Resend's answer, never the key
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'resend',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}
}
