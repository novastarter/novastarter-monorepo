import { InvalidConfigError, InvalidPayloadError, toProviderCallError } from '@novastarter/errors';
import {
	type CallOptions,
	type CallResponse,
	DEFAULT_REQUEST_TIMEOUT,
	parseCallMethod,
	resolveCallUrl,
	toHeaderRecord,
} from '@novastarter/http';
import type { SmsDriver, SmsMessage, SmsResult } from '@novastarter/sms';
import { withTimeout } from '@novastarter/utils';
import twilio from 'twilio';
import { describeError, describeTransportError } from './describe-error.js';
import { toTwilioMessage } from './to-twilio-message.js';

/**
 * The client `twilio()` builds; kept as a type of its own, since the SDK exports it only through its namespace.
 */
export type TwilioClient = ReturnType<typeof twilio>;

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
	 * Twilio's own SDK client, bound to the location's credentials and timeout: the SDK's whole API, for what `send()`
	 * and {@link call} do not cover — typed resources, paging, a Serverless asset upload.
	 *
	 * @example
	 * ```ts
	 * const twilio = useSms().location('twilio') as SmsDriverTwilio;
	 *
	 * const messages = await twilio.client.messages.list({ to: '+15558675310', limit: 50 });
	 * ```
	 */
	readonly client: TwilioClient;

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
	 * Create a driver on a client of its own for the given account.
	 *
	 * @param config - Credentials and the location's defaults.
	 * @throws InvalidConfigError without an account SID, or without either an auth token or a complete API key pair.
	 */
	constructor(config: SmsDriverTwilioConfig) {
		if (!config.accountSid) {
			throw new InvalidConfigError({ reason: 'The twilio sms driver needs an "accountSid"' });
		}

		// Half a key pair is neither way to authenticate; naming both in the message spares the reader the console.
		const hasApiKey = Boolean(config.apiKey && config.apiSecret);

		if (!config.authToken && !hasApiKey) {
			throw new InvalidConfigError({
				reason: 'The twilio sms driver needs an "authToken", or an "apiKey" with its "apiSecret"',
			});
		}

		// An API key signs for the account it is scoped to, so the account SID travels in the options; the auth token
		// is the account's own and goes in as the user name.
		const options = config.timeout !== undefined ? { timeout: config.timeout } : {};

		this.client = hasApiKey
			? twilio(config.apiKey, config.apiSecret, { ...options, accountSid: config.accountSid })
			: twilio(config.accountSid, config.authToken, options);

		// `call()` fills `{AccountSid}` from this; its deadline is the SDK's own 30 s unless given.
		this.accountSid = config.accountSid;
		this.timeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT;

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
		// `describeError` keeps Twilio's own error code, which is what an application matches on.
		const created = await this.client.messages
			.create(toTwilioMessage(message, this.defaults))
			.catch((error: unknown) => {
				throw describeError(error);
			});

		// A message may come back accepted and already failed (an unusable number, a recipient who unsubscribed), so
		// the error code of the answer is checked too.
		if (created.errorCode) {
			throw new Error(`Twilio: ${created.errorCode}: ${created.errorMessage || created.status}`, {
				cause: created,
			});
		}

		// Segments are what the message is billed by, and the SDK reports the count as a string. `Number(null)` and
		// `Number('')` are 0, which would claim the text was split into zero parts, so the count is only reported when
		// Twilio actually says one.
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
		// The account balance is the cheapest authenticated read there is: no resource is created, nothing is billed.
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
	 * `*.twilio.com` host. Another `{name}` in it is filled from the parameter of that name, URL-encoded, and that
	 * parameter is not sent again. The parameters are the query of a `GET`, `HEAD` or `DELETE` and a form body
	 * otherwise, as Twilio's APIs take them; a `content-type: application/json` header, in any case, sends them as JSON
	 * for the few that want it. No other type is sent. A file is not sent: the SDK's client makes no multipart body.
	 *
	 * @typeParam T - What the request answers with; the caller knows it from Twilio's documentation.
	 * @param method - The verb and the path or full URL: `GET /2010-04-01/Accounts/{AccountSid}/Messages/SM123.json`.
	 * @param params - The placeholders' values, and its query or body; `undefined` ones are left out.
	 * @param options - A timeout over the location's, an abort signal, extra headers.
	 * @returns The status, the headers — names lower-cased — and Twilio's answer: parsed JSON, else text; `undefined`
	 * for an empty one.
	 * @throws ProviderCallError when Twilio answers with an error status — its status and answer (`code`, `message`,
	 * `more_info`) in `extensions`.
	 * @throws HitRateLimitError when Twilio answers `429`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws InvalidPayloadError when a file is among the parameters, or a content type is neither a form nor JSON.
	 * @throws Error when the method is malformed, a `{name}` placeholder is left unfilled, its URL is not on a Twilio
	 * host, or Twilio cannot be reached — the SDK's error left out, since it carries the credentials.
	 * @example
	 * ```ts
	 * const sms = useSms().location('twilio');
	 * const { data } = await sms.call!('GET /2010-04-01/Accounts/{AccountSid}/Messages/{sid}.json', { sid: 'SM123' });
	 * const { headers } = await sms.call!('GET https://lookups.twilio.com/v2/PhoneNumbers/+15558675310', {
	 * 	Fields: 'line_type_intelligence',
	 * });
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options: CallOptions = {},
	): Promise<CallResponse<T>> {
		// A URL on a foreign host is refused before the credentials are used. `{AccountSid}` left in the path is the
		// location's account, since nearly every core path starts with it.
		const { verb, target, params: rest } = parseCallMethod(method, params);
		const url = resolveCallUrl(TWILIO_API_URL, target.replaceAll('{AccountSid}', this.accountSid), TWILIO_CALL_HOSTS);

		// A file is refused rather than sent as the text `[object File]`, since the SDK's client makes no multipart
		// body.
		const defined = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));

		if (hasFile(defined)) {
			throw new InvalidPayloadError({
				reason: 'The twilio call sends no file; upload it through the SDK client: `driver.client`',
			});
		}

		// A body is a form unless the caller's header says JSON: the SDK fills a form body only under that exact
		// `Content-Type`.
		const inQuery = verb === 'GET' || verb === 'HEAD' || verb === 'DELETE';
		const headers = toTwilioHeaders(options.headers, inQuery);
		const timeout = options.timeout ?? this.timeout;

		// What the SDK throws is an axios error carrying the `Authorization` header in its config, so it never leaves
		// here: a plain error naming its code takes its place.
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

		const body = parseBody(response.body);

		// No header sent, and so no credential, goes into the error.
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw toProviderCallError({
				provider: 'twilio',
				method,
				status: response.statusCode,
				body,
				headers: response.headers,
			});
		}

		return { status: response.statusCode, headers: toHeaderRecord(response.headers), data: body as T };
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
		// The whole path is optional: a custom or mocked client may have none of it and nothing to release, and a
		// failed destroy must not mask a clean shutdown.
		const agent = this.client.httpClient?.axios?.defaults?.httpsAgent as { destroy?: () => void } | undefined;

		agent?.destroy?.();
	}
}

/**
 * The caller's headers as the SDK reads them: a content type given in any case taken out, its parameters (`;
 * charset=…`) dropped, and set back as `Content-Type` — the only spelling the SDK honours, so a body is never
 * form-encoded while labelled JSON. A body without a type of the caller's is a form, as Twilio's APIs take it.
 *
 * @param headers - The caller's headers.
 * @param inQuery - Whether the parameters go in the query, where no body needs a type.
 * @returns The headers to hand the SDK.
 * @throws InvalidPayloadError when the caller's content type is neither a form nor JSON, the only bodies the SDK makes.
 * @internal
 */
const toTwilioHeaders = (headers: Record<string, string> | undefined, inQuery: boolean): Record<string, string> => {
	const rest: Record<string, string> = {};
	let type: string | undefined;

	for (const [name, value] of Object.entries(headers ?? {})) {
		if (name.toLowerCase() === 'content-type') type = value.split(';')[0]?.trim().toLowerCase();
		else rest[name] = value;
	}

	if (type === undefined || type === '') return inQuery ? rest : { ...rest, 'Content-Type': TWILIO_FORM_TYPE };

	// The SDK encodes a form or JSON only; any other type would label a body it is not.
	if (type !== TWILIO_FORM_TYPE && type !== 'application/json') {
		throw new InvalidPayloadError({
			reason: 'The twilio call sends a form or JSON only; its content-type must be one of them',
		});
	}

	return { ...rest, 'Content-Type': type };
};

/**
 * Whether the parameters carry a file — a `Blob` or `File` — at the top level or in a list, which the SDK's client
 * cannot send.
 *
 * @param params - The defined parameters.
 * @returns `true` when a file is among them.
 * @internal
 */
const hasFile = (params: Record<string, unknown>): boolean => {
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
	// An object is what axios already parsed.
	if (typeof body !== 'string') {
		return body ?? undefined;
	}

	if (body.length === 0) {
		return undefined;
	}

	// A body that is not JSON, such as an HTML error page from a proxy in between, stays text.
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
};
