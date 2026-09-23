import { toProviderCallError } from '@novastarter/errors';
import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import { type CallOptions, callParamsIn, type CallVerb, parseCallMethod, withTimeout } from '@novastarter/utils';
import { httpCall, resolveCallUrl } from '@novastarter/utils/node';
import twilio from 'twilio';
import { describeError, describeTransportError } from './describe-error.js';
import { toTwilioMessage } from './to-twilio-message.js';

/**
 * The client `twilio()` builds; kept as a type of its own, since the SDK exports it only through its namespace.
 */
type TwilioClient = ReturnType<typeof twilio>;

/**
 * The root a {@link SmsDriverTwilio.call} path is joined to: the core REST API.
 *
 * @defaultValue `https://api.twilio.com`
 * @internal
 */
const TWILIO_API_URL = 'https://api.twilio.com';

/**
 * The form content type — what the SDK sends a body as, and what Twilio's APIs take.
 *
 * @defaultValue `application/x-www-form-urlencoded`
 * @internal
 */
const TWILIO_FORM_TYPE = 'application/x-www-form-urlencoded';

/**
 * The JSON content type, for the few Twilio APIs that take a JSON body.
 *
 * @defaultValue `application/json`
 * @internal
 */
const TWILIO_JSON_TYPE = 'application/json';

/**
 * How long a {@link SmsDriverTwilio.call} may take when neither the call nor the location sets a timeout, in
 * milliseconds — the SDK's own default.
 *
 * @defaultValue 30 000 ms.
 */
export const DEFAULT_TWILIO_CALL_TIMEOUT = 30_000;

/**
 * Hosts a full URL of {@link SmsDriverTwilio.call} may point at: Twilio's product APIs — Lookup, Verify, Messaging,
 * Conversations — each live on a subdomain of `twilio.com`. No other host receives the credentials.
 *
 * @defaultValue `*.twilio.com`
 * @internal
 */
const TWILIO_CALL_HOSTS: readonly string[] = ['*.twilio.com'];

/**
 * What the SDK's `request()` resolves with: the answer as it came, whatever its status.
 *
 * @internal
 */
type TwilioRawResponse = {
	/** The HTTP status. */
	statusCode: number;
	/** The body: already parsed JSON, or the text. */
	body: unknown;
	/** The response headers. */
	headers?: Record<string, string | string[] | undefined> | undefined;
};

/**
 * Options accepted by {@link SmsDriverTwilio}.
 */
export type SmsDriverTwilioConfig = {
	/** Account SID from the Twilio console (`AC…`). */
	accountSid: string;
	/** Auth token of the account; the alternative to an API key pair. */
	authToken?: string | undefined;
	/** API key SID (`SK…`), used with `apiSecret` instead of the auth token. */
	apiKey?: string | undefined;
	/** Secret of the API key. */
	apiSecret?: string | undefined;
	/** Messaging service (`MG…`) that picks the sender for a message without a `from` of its own. */
	messagingServiceSid?: string | undefined;
	/** URL Twilio posts delivery status updates to. */
	statusCallback?: string | undefined;
	/** How long a request may take, in milliseconds; the SDK's 30 s unless given. */
	timeout?: number | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/sms`, so a location naming `twilio` has its options
 * checked against {@link SmsDriverTwilioConfig}.
 */
declare module '@novastarter/sms' {
	interface SmsDrivers {
		twilio: SmsDriverTwilioConfig;
	}
}

/**
 * Driver for [Twilio](https://www.twilio.com) Programmable Messaging.
 *
 * An API key pair is preferred over the account's auth token, since a key can be revoked on its own; either one
 * authenticates the same account.
 *
 * @example
 * ```ts
 * import { useSms } from '@novastarter/sms';
 * import { SmsDriverTwilio } from '@novastarter/sms-driver-twilio';
 * import { env } from './env';
 *
 * const sms = useSms();
 *
 * sms.registerDriver('twilio', SmsDriverTwilio);
 * sms.registerLocation('main', {
 * 	driver: 'twilio',
 * 	options: {
 * 		accountSid: env.SMS_TWILIO_ACCOUNT_SID,
 * 		authToken: env.SMS_TWILIO_AUTH_TOKEN,
 * 	},
 * });
 * ```
 */
export class SmsDriverTwilio implements SmsDriver {
	/**
	 * Twilio's client, bound to the location's credentials.
	 *
	 * @internal
	 */
	private readonly client: TwilioClient;

	/**
	 * What every message of this location carries on top of its own fields.
	 *
	 * @internal
	 */
	private readonly defaults: Pick<SmsDriverTwilioConfig, 'messagingServiceSid' | 'statusCallback'>;

	/**
	 * The account SID — what `{AccountSid}` in a {@link call} path stands for.
	 *
	 * @internal
	 */
	private readonly accountSid: string;

	/**
	 * How long a {@link call} may take unless the call says otherwise, in milliseconds.
	 *
	 * @internal
	 */
	private readonly timeout: number;

	/**
	 * The Basic `Authorization` header the client signs with — the API key pair, or the account SID and its auth
	 * token — for the uploads {@link call} makes itself, since the SDK's client sends no multipart body.
	 *
	 * @internal
	 */
	private readonly authorization: string;

	/**
	 * Create a driver on a client of its own for the given account.
	 *
	 * @param config - Credentials and the location's defaults.
	 * @throws Error without an account SID, or without either an auth token or a complete API key pair.
	 */
	constructor(config: SmsDriverTwilioConfig) {
		// 1. A missing account is a configuration error; report it by the option's name
		if (!config.accountSid) {
			throw new Error('The twilio sms driver needs an "accountSid"');
		}

		// 2. Two ways to authenticate, and half a key pair is neither; naming both spares the reader the console
		const hasApiKey = Boolean(config.apiKey && config.apiSecret);

		if (!config.authToken && !hasApiKey) {
			throw new Error('The twilio sms driver needs an "authToken", or an "apiKey" with its "apiSecret"');
		}

		// 3. An API key signs for the account it is scoped to, so the account SID travels in the options; the auth
		//    token is the account's own and goes in as the user name
		const options = config.timeout !== undefined ? { timeout: config.timeout } : {};

		this.client = hasApiKey
			? twilio(config.apiKey, config.apiSecret, { ...options, accountSid: config.accountSid })
			: twilio(config.accountSid, config.authToken, options);

		// 4. The same pair the client signs with, kept as a header for the uploads made without the client
		const username = hasApiKey ? config.apiKey : config.accountSid;
		const password = hasApiKey ? config.apiSecret : config.authToken;

		this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
		this.accountSid = config.accountSid;
		this.timeout = config.timeout ?? DEFAULT_TWILIO_CALL_TIMEOUT;

		this.defaults = {
			...(config.messagingServiceSid !== undefined ? { messagingServiceSid: config.messagingServiceSid } : {}),
			...(config.statusCallback !== undefined ? { statusCallback: config.statusCallback } : {}),
		};
	}

	/**
	 * Send through the Twilio API.
	 *
	 * @param message - Message with its recipient in E.164.
	 * @returns Twilio's message SID, the status it queued the message under and the number of segments it was split
	 * into.
	 * @throws Error naming Twilio's status and error code when the API refuses, or when it accepts a message it
	 * already knows it cannot deliver; the SDK's error as the cause.
	 */
	async send(message: SmsMessage): Promise<SmsResult> {
		// 1. The SDK rejects with a `RestException` for anything the API refused; `describeError` keeps Twilio's own
		//    error code, which is what an application matches on
		const created = await this.client.messages
			.create(toTwilioMessage(message, this.defaults))
			.catch((error: unknown) => {
				throw describeError(error);
			});

		// 2. A message may come back accepted and already failed — an unusable number, a recipient who unsubscribed —
		//    so the error code of the answer is checked too, and reported as a failure rather than as a send
		if (created.errorCode) {
			throw new Error(`Twilio: ${created.errorCode}: ${created.errorMessage || created.status}`, {
				cause: created,
			});
		}

		// 3. Segments are what the message is billed by; the SDK reports the count as a string. `Number(null)` and
		//    `Number('')` are 0 — a value that would claim the text was split into zero parts — so the count is only
		//    reported when Twilio actually says one
		const segments = Number(created.numSegments);

		return {
			messageId: created.sid,
			status: created.status,
			...(created.numSegments != null && created.numSegments !== '' && Number.isFinite(segments) ? { segments } : {}),
		};
	}

	/**
	 * Check the credentials without sending.
	 *
	 * @throws Error naming Twilio's status when the account cannot be read.
	 */
	async verify(): Promise<void> {
		// 1. The account balance is the cheapest authenticated read there is: no resource is created, nothing is billed
		await this.client.balance.fetch().catch((error: unknown) => {
			throw describeError(error);
		});
	}

	/**
	 * Make a request of a Twilio API through the SDK's client, with the location's credentials, timeout and the kit's
	 * errors.
	 *
	 * The way to what `send()` does not cover — a message's status, a Lookup, a Verify check. The `method` is a verb and
	 * a path from `https://api.twilio.com`, where `{AccountSid}` stands for the location's account, or a full URL on a
	 * `*.twilio.com` host. The parameters are the query of a `GET`, `HEAD` or `DELETE` and a form body otherwise, as
	 * Twilio's APIs take them — `options.paramsIn` moves them; a `content-type: application/json` header sends them as
	 * JSON for the few that want it.
	 *
	 * A file — a `Blob` or `File` among the parameters, or in a list of them — is uploaded as a multipart body, a
	 * Serverless asset version for one. The SDK's client sends no multipart body, so that request is made without it,
	 * with the same credentials, host check, deadline and errors; the caller's content type is dropped for the
	 * multipart one.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from Twilio's documentation.
	 * @param method - The verb and the path or full URL: `GET /2010-04-01/Accounts/{AccountSid}/Messages/SM123.json`.
	 * @param params - Its query or body; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers, where the parameters go.
	 * @returns Twilio's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError when Twilio answers with an error status — its status and answer (`code`, `message`,
	 * `more_info`) in `extensions`.
	 * @throws HitRateLimitError when Twilio answers `429`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when the method is malformed, its URL is not on a Twilio host, the content type is neither a form
	 * nor JSON, a file is put in the query, or Twilio cannot be reached — the SDK's error left out, since it carries
	 * the credentials.
	 * @example
	 * ```ts
	 * const sms = useSms().location('twilio');
	 * const lookup = await sms.call!('GET https://lookups.twilio.com/v2/PhoneNumbers/+15558675310', {
	 * 	Fields: 'line_type_intelligence',
	 * });
	 * const versions = 'https://serverless-upload.twilio.com/v1/Services/ZS123/Assets/ZH123/Versions';
	 * const version = await sms.call!(`POST ${versions}`, {
	 * 	Path: '/logo.png',
	 * 	Visibility: 'public',
	 * 	Content: new File([png], 'logo.png', { type: 'image/png' }),
	 * });
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The method checked and resolved before anything is sent: a URL on a foreign host is refused with the
		//    credentials never used. `{AccountSid}` is filled in, since nearly every core path starts with the account
		const { verb, target } = parseCallMethod(method);
		const url = resolveCallUrl(TWILIO_API_URL, target.replaceAll('{AccountSid}', this.accountSid), TWILIO_CALL_HOSTS);

		// 2. Parameters without the `undefined` ones; the query or the body by the verb, unless the caller said
		const defined = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
		const inQuery = callParamsIn(verb, options.paramsIn) === 'query';

		// 3. A file goes as a multipart body, which the SDK's client cannot send: the upload is made without it. A file
		//    has no place in a query, so one there is refused rather than sent as the text of an empty object
		if (hasFile(defined)) {
			if (inQuery) {
				throw new Error(`The twilio call sends a file in a body only, not in the query of ${verb}`);
			}

			return this.upload<T>(method, url, verb, defined, options);
		}

		// 4. The SDK fills the body only when `Content-Type` is spelled exactly so and is a form or JSON — and sets
		//    none of its own for a verb other than `POST` — so a caller's type is normalized and checked, and a body
		//    goes as a form unless the caller asked for JSON; the other headers go as given, over the SDK's own
		const headers: Record<string, string> = {};
		let contentType: string | undefined;

		for (const [name, value] of Object.entries(options.headers ?? {})) {
			if (name.toLowerCase() === 'content-type') {
				contentType = value.split(';')[0]?.trim().toLowerCase();
			} else {
				headers[name] = value;
			}
		}

		if (contentType !== undefined && contentType !== TWILIO_FORM_TYPE && contentType !== TWILIO_JSON_TYPE) {
			throw new Error(`The twilio call sends a form or JSON body only, not "${contentType}"`);
		}

		if (!inQuery || contentType !== undefined) {
			headers['Content-Type'] = contentType ?? TWILIO_FORM_TYPE;
		}

		const timeout = options.timeout ?? this.timeout;

		// 5. The SDK signs the request and answers whatever the status; its own timeout is set, and the deadline
		//    enforces it as the kit's `TimeoutError` and honours the caller's abort — an aborted signal sends nothing.
		//    What the SDK throws — an axios error carrying the `Authorization` header in its config — never leaves
		//    here: a plain error naming its code takes its place
		const response: TwilioRawResponse = await withTimeout(
			() =>
				(
					this.client.request({
						method: verb.toLowerCase() as NonNullable<Parameters<TwilioClient['request']>[0]['method']>,
						uri: url.href,
						...(inQuery ? { params: defined } : { data: defined }),
						headers,
						timeout,
					}) as Promise<TwilioRawResponse>
				).catch((error: unknown) => {
					throw describeTransportError(error);
				}),
			timeout,
			options.signal ? { signal: options.signal } : {},
		);

		// 6. The body arrives parsed when it was JSON, as text otherwise; an empty one is nothing
		const body = parseBody(response.body);

		// 7. A non-2xx answer becomes the kit's error, Twilio's `{ code, message, more_info }` kept as the body; no
		//    header sent — the credentials — goes into it
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw toProviderCallError({
				provider: 'twilio',
				method,
				status: response.statusCode,
				body,
				headers: response.headers,
			});
		}

		return body as T;
	}

	/**
	 * Upload a file for {@link call}: a multipart request made with `httpCall`, since the SDK's client sends none.
	 *
	 * The credentials are the client's, as a Basic header; redirects are followed without them leaving the origin, and
	 * the deadline covers the reading of the answer.
	 *
	 * @typeParam T - What the request answers with.
	 * @param method - The method as the caller wrote it, for the error.
	 * @param url - The URL, already checked to be on a Twilio host.
	 * @param verb - The verb.
	 * @param params - The defined parameters, a file among them.
	 * @param options - The timeout, the signal, the caller's headers and where the parameters go.
	 * @returns Twilio's answer: parsed JSON, else text; `undefined` for an empty one.
	 * @throws ProviderCallError, or HitRateLimitError for a 429, when Twilio answers with an error status.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when Twilio cannot be reached — `fetch`'s error, which carries no request header.
	 * @internal
	 */
	private async upload<T>(
		method: string,
		url: URL,
		verb: CallVerb,
		params: Record<string, unknown>,
		options: CallOptions,
	): Promise<T> {
		// 1. The client's credentials, the caller's headers on top; `httpCall` builds the multipart body and its type
		const response = await httpCall({
			url,
			verb,
			params,
			paramsIn: options.paramsIn,
			headers: { authorization: this.authorization, ...options.headers },
			timeout: options.timeout ?? this.timeout,
			signal: options.signal,
		});

		// 2. A non-2xx answer becomes the kit's error, Twilio's `{ code, message, more_info }` as the body; no header
		//    sent — the credentials — goes into it
		if (response.status < 200 || response.status >= 300) {
			throw toProviderCallError({
				provider: 'twilio',
				method,
				status: response.status,
				body: response.body,
				headers: response.headers,
			});
		}

		return response.body as T;
	}

	/**
	 * Destroy the keep-alive HTTPS agent the SDK's request client pools its connections in.
	 *
	 * The SDK exposes no close of its own: its `RequestClient` hangs the `https.Agent` off its axios instance's
	 * defaults, so that is where the driver reaches it. A client without such an agent — a custom or mocked one —
	 * simply has nothing to release.
	 *
	 * @returns Once the sockets are released.
	 */
	async close(): Promise<void> {
		// 1. The agent lives on the axios defaults of the client's request client, so the whole path is optional:
		//    a custom or mocked client without any of it has nothing to release, and a failed destroy must not mask
		//    a clean shutdown
		const agent = this.client.httpClient?.axios?.defaults?.httpsAgent as { destroy?: () => void } | undefined;

		agent?.destroy?.();
	}
}

/**
 * Whether the parameters carry a file — a `Blob` or `File` — at the top level or in a list, which makes the request a
 * multipart upload.
 *
 * @param params - The defined parameters.
 * @returns `true` when a file is among them.
 * @internal
 */
const hasFile = (params: Record<string, unknown>): boolean => {
	// 1. The two places `httpCall` turns into multipart parts: a parameter itself, or an item of a list
	return Object.values(params).some(
		(value) => value instanceof Blob || (Array.isArray(value) && value.some((item) => item instanceof Blob)),
	);
};

/**
 * Normalise the body the SDK's client answers with: parsed JSON as is, JSON text parsed, other text as is.
 *
 * @param body - The body as the SDK handed it.
 * @returns The parsed body; `undefined` for an empty one.
 * @internal
 */
const parseBody = (body: unknown): unknown => {
	// 1. Only text needs work; an object is what axios already parsed
	if (typeof body !== 'string') {
		return body ?? undefined;
	}

	if (body.length === 0) {
		return undefined;
	}

	// 2. JSON when it parses, the text otherwise — an HTML error page from a proxy in between
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
};
