import { defineJob, type JobContract, type JobHandler, registerJob } from '@novastarter/queue';
import { isPhoneNumber, normalizePhoneNumber, sendSms, type SmsCategory, type SmsMessage } from '@novastarter/sms';
import { z } from 'zod';

/**
 * What a caller passes to `sms.send`.
 *
 * The text is ready: an SMS carries no markup and no template, so the caller renders it — a one-time code, a delivery
 * notice — and the job only sends.
 */
export interface SmsSendInput {
	/** Recipient; spaces, dashes and a `00` prefix are cleaned up, what is left has to be E.164. */
	to: string;
	text: string;
	/** Sender, overriding the one of the routes. */
	from?: string | undefined;
	/** `transactional` unless given. */
	route?: SmsCategory | undefined;
	/** An SMS location by name, overriding the route. */
	location?: string | undefined;
	/** How long the provider keeps trying to deliver, in seconds. */
	ttl?: number | undefined;
	/** Caller's reference the provider records when it takes one. */
	reference?: string | undefined;
}

/**
 * What the `sms.send` handler receives: the input with the defaults applied and the recipient normalised.
 */
export interface SmsSendPayload extends Omit<SmsSendInput, 'route'> {
	route: SmsCategory;
}

/**
 * Schema of an `sms.send` payload.
 *
 * The recipient is normalised before it is checked, so a number typed with spaces or a `00` prefix is accepted and
 * stored in the job as E.164 — the same rules `sendSms()` applies, run here so a malformed number fails at
 * `enqueue()` rather than in a worker.
 */
export const smsSendSchema: z.ZodType<SmsSendPayload, SmsSendInput> = z.object({
	to: z
		.string()
		.transform(normalizePhoneNumber)
		.refine(isPhoneNumber, { message: 'A phone number in E.164 is required, for example +14155550123' }),
	text: z.string().min(1),
	from: z.string().min(1).optional(),
	route: z.enum(['transactional', 'marketing']).default('transactional'),
	location: z.string().min(1).optional(),
	ttl: z.number().int().positive().optional(),
	reference: z.string().min(1).optional(),
});

/**
 * `sms.send` — one message through `sendSms()` of `@novastarter/sms`, off the request.
 *
 * Delivery is retried five times with growing waits: an SMS provider that is down for a minute should not lose the
 * message. Registered with the queue when this module loads, so `enqueue('sms.send', …)` is known wherever the
 * bootstrap ran.
 */
export const smsSend: JobContract<'sms.send', typeof smsSendSchema> = registerJob(
	defineJob({
		name: 'sms.send',
		schema: smsSendSchema,
		options: {
			attempts: 5,
			backoff: { type: 'exponential', delay: 5_000 },
		},
	}),
);

/**
 * Registers the contract in the job map of `@novastarter/queue`, so `enqueue('sms.send', payload)` checks the payload
 * against {@link smsSendSchema}.
 */
declare module '@novastarter/queue' {
	interface JobRegistry {
		'sms.send': typeof smsSend;
	}
}

/**
 * Turn an `sms.send` payload into a message.
 *
 * @param payload - Parsed job payload.
 * @returns The message for `sendSms()`.
 */
export const toSmsMessage = (payload: SmsSendPayload): SmsMessage => {
	// 1. The job-only fields are split off; what remains is a message as the drivers take it
	const { route, location: _location, ...rest } = payload;

	return { ...rest, category: route };
};

/**
 * Build the handler of the `sms.send` job — what the bootstrap registers with `registerJobHandlers()`.
 *
 * A failing send throws, so the queue retries by the contract's rules (five tries with growing waits); `sendSms()`
 * already fell back down the location chain before that.
 *
 * @returns The handler.
 */
export const createSmsSendHandler = (): JobHandler<typeof smsSend> => {
	// 1. The factory keeps the shape of the sibling handlers: nothing is captured today, and options arrive without
	//    a rewrite of the bootstrap or the tests
	return async (payload: SmsSendPayload): Promise<void> => {
		// 1. The message is sent inside the job, so a provider failure is retried rather than losing the message
		await sendSms(toSmsMessage(payload), { location: payload.location });
	};
};
