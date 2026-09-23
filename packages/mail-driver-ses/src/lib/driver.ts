import * as sesv2 from '@aws-sdk/client-sesv2';
import { SendEmailCommand, SESv2Client, SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { toProviderCallError } from '@novastarter/errors';
import { type CallOptions, type CallResponse, DEFAULT_REQUEST_TIMEOUT } from '@novastarter/http';
import {
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailResult,
	toNodemailerMessage,
} from '@novastarter/mail';
import { withTimeout } from '@novastarter/utils';
import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import { describeError } from './describe-error.js';
import { toSesClientConfig } from './to-ses-client-config.js';
import { toSesMessageTags } from './to-ses-message-tags.js';

/**
 * A command class of the SESv2 SDK, as {@link MailDriverSes.call} finds it by name in the SDK's exports.
 *
 * @internal
 */
type SesCommandClass = new (input: Record<string, unknown>) => Parameters<SESv2Client['send']>[0];

/**
 * Options accepted by {@link MailDriverSes}.
 *
 * Credentials are optional: without them the AWS SDK's default chain (environment, profile, instance role) applies.
 */
export type MailDriverSesConfig = {
	/** AWS region, e.g. `eu-west-1`; the SDK's default chain unless given. */
	region?: string | undefined;
	accessKeyId?: string | undefined;
	secretAccessKey?: string | undefined;
	sessionToken?: string | undefined;
	/** Custom endpoint, for LocalStack and the like. */
	endpoint?: string | undefined;
	/** SES configuration set every message is sent with. */
	configurationSet?: string | undefined;
};

/**
 * Registers the driver's options in the map of `@novastarter/mail`, so a location naming `ses` has its options
 * checked against {@link MailDriverSesConfig}.
 */
declare module '@novastarter/mail' {
	interface MailDrivers {
		ses: MailDriverSesConfig;
	}
}

/**
 * Driver for [Amazon SES](https://aws.amazon.com/ses/), through nodemailer's SES transport on the SESv2 SDK.
 *
 * The category and the tags become SES message tags, which show up in the sending events. SES takes only ASCII
 * letters, digits, `_` and `-` in a tag name or value, at most 256 characters of either, so every tag is sanitised
 * on the way (`welcome flow` becomes `welcome_flow`), and one left with no name or with a name already taken
 * (`welcome flow` next to `welcome_flow`, or `category`) is dropped, rather than failing the whole send.
 *
 * @example
 * ```ts
 * import { useMail } from '@novastarter/mail';
 * import { MailDriverSes } from '@novastarter/mail-driver-ses';
 * import { env } from './env';
 *
 * const mail = useMail();
 *
 * mail.registerDriver('ses', MailDriverSes);
 * mail.registerLocation('main', {
 * 	driver: 'ses',
 * 	options: {
 * 		region: 'eu-west-1',
 * 		accessKeyId: env.MAIL_SES_ACCESS_KEY_ID,
 * 		secretAccessKey: env.MAIL_SES_SECRET_ACCESS_KEY,
 * 	},
 * });
 * ```
 */
export class MailDriverSes implements MailDriver {
	/**
	 * nodemailer's SES transport on a client of the location's own.
	 *
	 * @internal
	 */
	private readonly transporter: Transporter;

	/**
	 * The SESv2 SDK's own client, on the location's region, credentials and endpoint — the one the transport sends
	 * through. It is the whole SESv2 API, for what {@link MailDriverSes.call} does not cover: paginators, waiters,
	 * middleware.
	 *
	 * @example
	 * ```ts
	 * import { paginateListSuppressedDestinations } from '@aws-sdk/client-sesv2';
	 *
	 * const ses = useMail().location('ses') as MailDriverSes;
	 *
	 * for await (const page of paginateListSuppressedDestinations({ client: ses.client }, {})) {
	 * 	console.log(page.SuppressedDestinationSummaries);
	 * }
	 * ```
	 */
	readonly client: SESv2Client;

	/**
	 * Configuration set every message is sent with, when the location names one.
	 *
	 * @internal
	 */
	private readonly configurationSet: string | undefined;

	/**
	 * Create a driver on an SES client of its own.
	 *
	 * @param config - Region, credentials, endpoint, configuration set.
	 * @throws Error when only one half of the `accessKeyId` / `secretAccessKey` pair is given.
	 */
	constructor(config: MailDriverSesConfig = {}) {
		// 1. A client per location, so two regions or two accounts never share credentials; `toSesClientConfig` is
		//    what refuses half a credential pair
		this.client = new SESv2Client(toSesClientConfig(config));

		this.transporter = nodemailer.createTransport({ SES: { sesClient: this.client, SendEmailCommand } });
		this.configurationSet = config.configurationSet;
	}

	/**
	 * Send through SES.
	 *
	 * The whole send, retries included, is bounded to 30 seconds.
	 *
	 * @param message - Rendered message.
	 * @returns SES's message id and the envelope recipients as accepted.
	 * @throws An error naming SES with the SDK's or nodemailer's error as the cause when SES refuses, or with a
	 * `TimeoutError` as the cause when the send outlives 30 seconds.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Tags and the configuration set ride on the `ses` field nodemailer merges into the SendEmailCommand; the tags
		//    are sanitised first, since SES refuses the whole message over one name outside its character set. The
		//    whole send is bounded: the client's request deadline stops at the response headers and the SDK retries
		//    a timed-out attempt, so a stalled body or three slow attempts would otherwise hold the send (and the
		//    fallback to the next location) far past the deadline
		let info: SentMessageInfo;

		try {
			info = await withTimeout(
				this.transporter.sendMail({
					...toNodemailerMessage(message),
					ses: {
						EmailTags: toSesMessageTags(message),
						...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
					},
				} as Parameters<Transporter['sendMail']>[0]),
				DEFAULT_REQUEST_TIMEOUT,
			);
		} catch (error) {
			// 2. The transport or the SDK throws on a refusal, the deadline with a `TimeoutError`; wrapped so the log
			//    names the provider
			throw describeError(error);
		}

		// 3. nodemailer reports the envelope; SES itself answers with the message id only
		return toMailResult(info);
	}

	/**
	 * Release the SDK's HTTP agents; the process is shutting down.
	 *
	 * @returns Once the client is destroyed.
	 */
	async close(): Promise<void> {
		// 1. The SES transport holds no sockets of its own and nodemailer defines no `close()` on it, so there is
		//    nothing to release there; the SDK client's keep-alive agents are what keeps the process up
		this.client.destroy();
	}

	/**
	 * Run any SESv2 API action with the location's client — the way to the account, identities, suppressions,
	 * templates and anything else the driver has no wrapper for.
	 *
	 * SES is an RPC-style SDK, so `method` is the name of an action: `GetAccount`, `ListSuppressedDestinations`, with or
	 * without the SDK's `Command` suffix. It is looked up among the SDK's command classes, so only a real SESv2 action
	 * runs, always on the location's own client, region and credentials; `params` is the action's input. The SDK
	 * signs its own requests and sends no extra header, so `headers` — the call's or the location's — are refused
	 * rather than dropped; for anything beyond a plain action, use {@link MailDriverSes.client}.
	 *
	 * @typeParam T - What the action answers with: its output shape from the SDK.
	 * @param method - The action's name.
	 * @param params - The action's input.
	 * @param options - A timeout (30 s unless given) and an abort signal; `headers` are refused.
	 * @returns The HTTP status, no headers — the SDK's output drops them — and the action's output without the SDK's
	 * `$metadata`.
	 * @throws ProviderCallError when SES refuses — its HTTP status in `extensions`, its `{ name, message }` as the body.
	 * @throws HitRateLimitError when SES answers 429 or `TooManyRequestsException`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when `method` names no SESv2 action, or headers are given.
	 * @example
	 * ```ts
	 * const { data: account } = await useMail().location('ses').call!('GetAccount');
	 * ```
	 */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options: CallOptions = {},
	): Promise<CallResponse<T>> {
		// 1. Headers — the call's or the location's `call.headers` — cannot reach the SDK's signed request; refused
		//    rather than silently dropped
		if (Object.keys(options.headers ?? {}).length > 0) {
			throw new Error('SES call() sends no extra headers; use the SDK client');
		}

		// 2. The action by name among the SDK's exports; only a command class passes, so a name such as `SESv2Client`
		//    or a typo is refused before anything is sent
		const name = `${method.trim().replace(/Command$/, '')}Command`;

		const Command =
			/^[A-Z][A-Za-z0-9]*$/.test(name) && Object.hasOwn(sesv2, name)
				? (sesv2 as Record<string, unknown>)[name]
				: undefined;

		if (typeof Command !== 'function' || !(Command.prototype instanceof sesv2.$Command)) {
			throw new Error(`The ses call method "${method}" is not an SESv2 action such as "GetAccount"`);
		}

		// 3. The action on the location's client, abandoned at the timeout or the caller's abort: the SDK takes the
		//    signal and stops its request. The same timeout goes to each HTTP attempt, since the client's own 30 s
		//    request deadline would otherwise cut a longer one short and fail with the SDK's error, not the kit's
		const timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
		let output: sesv2.ServiceOutputTypes;

		try {
			output = await withTimeout(
				(signal) =>
					this.client.send(new (Command as SesCommandClass)(params), {
						abortSignal: signal,
						requestTimeout: timeout,
					}),
				timeout,
				options.signal ? { signal: options.signal } : {},
			);
		} catch (error) {
			// 4. A refusal of SES becomes the kit's error, with the status and the exception's name and message only —
			//    the credentials are never on it; a throttled request is a rate limit whatever the status says
			if (error instanceof SESv2ServiceException) {
				const throttled = error.name === 'TooManyRequestsException';

				throw toProviderCallError({
					provider: 'ses',
					method,
					status: throttled ? 429 : (error.$metadata.httpStatusCode ?? 500),
					body: { name: error.name, message: error.message },
					cause: error,
				});
			}

			throw error;
		}

		// 5. The output as SES described it; the SDK's request metadata gives the status and is not part of the data
		const { $metadata: metadata, ...data } = output;

		return { status: metadata.httpStatusCode ?? 200, headers: {}, data: data as T };
	}
}
