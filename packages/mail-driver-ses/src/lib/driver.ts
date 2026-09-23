import * as sesv2 from '@aws-sdk/client-sesv2';
import { SendEmailCommand, SESv2Client, SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { toProviderCallError } from '@novastarter/errors';
import {
	type MailDriver,
	type MailMessage,
	type MailResult,
	toMailResult,
	toNodemailerMessage,
} from '@novastarter/mail';
import { type CallOptions, withTimeout } from '@novastarter/utils';
import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import { describeError } from './describe-error.js';
import { toSesClientConfig } from './to-ses-client-config.js';
import { toSesMessageTags } from './to-ses-message-tags.js';

/**
 * How long a {@link MailDriverSes.call} may take unless the caller names another deadline, in milliseconds.
 *
 * @defaultValue 30 seconds.
 */
export const DEFAULT_SES_CALL_TIMEOUT = 30_000;

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
 * on the way (`welcome flow` becomes `welcome_flow`) and one left with no name is dropped, rather than failing the
 * whole send.
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
	 * The SES client behind the transport, kept to destroy it at shutdown.
	 *
	 * @internal
	 */
	private readonly sesClient: SESv2Client;

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
		this.sesClient = new SESv2Client(toSesClientConfig(config));

		this.transporter = nodemailer.createTransport({ SES: { sesClient: this.sesClient, SendEmailCommand } });
		this.configurationSet = config.configurationSet;
	}

	/**
	 * Send through SES.
	 *
	 * @param message - Rendered message.
	 * @returns SES's message id and the envelope recipients as accepted.
	 * @throws An error naming SES with the SDK's or nodemailer's error as the cause when SES refuses.
	 */
	async send(message: MailMessage): Promise<MailResult> {
		// 1. Tags and the configuration set ride on the `ses` field nodemailer merges into the SendEmailCommand; the tags
		//    are sanitised first, since SES refuses the whole message over one name outside its character set
		let info: SentMessageInfo;

		try {
			info = await this.transporter.sendMail({
				...toNodemailerMessage(message),
				ses: {
					EmailTags: toSesMessageTags(message),
					...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
				},
			} as Parameters<Transporter['sendMail']>[0]);
		} catch (error) {
			// 2. The transport or the SDK throws on a refusal; wrapped so the log names the provider
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
		this.sesClient.destroy();
	}

	/**
	 * Run any SESv2 API action with the location's client — the way to the account, identities, suppressions,
	 * templates and anything else the driver has no wrapper for.
	 *
	 * SES is an RPC-style SDK, so `method` is the name of an action: `GetAccount`, `ListSuppressedDestinations`, with or
	 * without the SDK's `Command` suffix. It is looked up among the SDK's command classes, so only a real SESv2 action
	 * runs, always on the location's own client, region and credentials; `params` is the action's input.
	 *
	 * @typeParam T - What the action answers with: its output shape from the SDK.
	 * @param method - The action's name.
	 * @param params - The action's input.
	 * @param options - A timeout ({@link DEFAULT_SES_CALL_TIMEOUT} unless given), an abort signal, and extra headers,
	 * added to the HTTP request before the SDK signs it; `paramsIn` does not apply, since the SDK serializes the input.
	 * @returns The action's output, without the SDK's `$metadata`.
	 * @throws ProviderCallError when SES refuses — its HTTP status in `extensions`, its `{ name, message }` as the body.
	 * @throws HitRateLimitError when SES answers 429 or `TooManyRequestsException`.
	 * @throws TimeoutError when the request outlives its timeout.
	 * @throws Error when `method` names no SESv2 action.
	 * @example
	 * ```ts
	 * const account = await useMail().location('ses').call?.('GetAccount');
	 * ```
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
		// 1. The action by name among the SDK's exports; only a command class passes, so a name such as `SESv2Client`
		//    or a typo is refused before anything is sent
		const name = `${method.trim().replace(/Command$/, '')}Command`;

		const Command =
			/^[A-Z][A-Za-z0-9]*$/.test(name) && Object.hasOwn(sesv2, name)
				? (sesv2 as Record<string, unknown>)[name]
				: undefined;

		if (typeof Command !== 'function' || !(Command.prototype instanceof sesv2.$Command)) {
			throw new Error(`The ses call method "${method}" is not an SESv2 action such as "GetAccount"`);
		}

		// 2. The caller's headers go onto the HTTP request in the SDK's build step — after the input is serialized,
		//    before the request is signed and sent — since `send()` takes no headers of its own
		const command = new (Command as SesCommandClass)(params);
		const headers = options.headers;

		if (headers) {
			command.middlewareStack.add(
				(next) => async (args) => {
					// 1. The build step's request is the SDK's `HttpRequest`, typed `unknown`; its headers are a record
					const request = args.request as { headers?: Record<string, string> } | undefined;

					if (request?.headers) Object.assign(request.headers, headers);

					return next(args);
				},
				{ step: 'build', name: 'novastarterCallHeaders' },
			);
		}

		// 3. The action on the location's client, abandoned at the timeout or the caller's abort: the SDK takes the
		//    signal and stops its request
		let output: sesv2.ServiceOutputTypes;

		try {
			output = await withTimeout(
				(signal) => this.sesClient.send(command, { abortSignal: signal }),
				options.timeout ?? DEFAULT_SES_CALL_TIMEOUT,
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

		// 5. The output as SES described it; the SDK's request metadata is not part of the answer
		const { $metadata: _metadata, ...result } = output;

		return result as T;
	}
}
