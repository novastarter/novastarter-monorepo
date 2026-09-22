import { InvalidPayloadError } from '@novastarter/errors';
import { type MailAddress, type MailCategory, type MailMessage, sendMail } from '@novastarter/mail';
import { defineJob, type JobContract, type JobHandler, registerJob } from '@novastarter/queue';
import { z } from 'zod';

/**
 * What a caller passes to `mail.send`.
 *
 * Either a `template` with its `props` — rendered by the app's renderer in the handler, which also produces the
 * subject unless one is given — or a ready `subject` with `html` / `text`.
 */
export interface MailSendInput {
	to: MailAddress | MailAddress[];
	cc?: MailAddress[] | undefined;
	bcc?: MailAddress[] | undefined;
	from?: MailAddress | undefined;
	replyTo?: MailAddress | undefined;
	/** Required without a template; overrides the template's subject with one. */
	subject?: string | undefined;
	/** Template name the app's renderer knows, e.g. `verify-email`. */
	template?: string | undefined;
	/** The template's props. */
	props?: Record<string, unknown> | undefined;
	/** Language the template is rendered in; `en` unless given. */
	locale?: string | undefined;
	html?: string | undefined;
	text?: string | undefined;
	/** `transactional` unless given. */
	route?: MailCategory | undefined;
	/** A mail location by name, overriding the route. */
	location?: string | undefined;
	headers?: Record<string, string> | undefined;
	/** Labels the provider records (Resend tags, SendGrid categories). */
	tags?: string[] | undefined;
}

/**
 * What the `mail.send` handler receives: the input with the defaults applied.
 */
export interface MailSendPayload extends Omit<MailSendInput, 'route'> {
	route: MailCategory;
}

/**
 * What a rendered template gives the handler.
 */
export interface RenderedTemplate {
	subject: string;
	html: string;
	text: string;
}

/**
 * Renders a template by name — the app's email templates, once it has some.
 *
 * @param template - Template name from the payload.
 * @param props - The template's props from the payload.
 * @param options - Locale from the payload.
 * @returns Subject and both bodies.
 */
export type TemplateRenderer = (
	template: string,
	props: Record<string, unknown>,
	options: { locale?: string | undefined },
) => Promise<RenderedTemplate>;

/**
 * What {@link createMailSendHandler} needs.
 */
export interface MailSendHandlerOptions {
	/** Renders `template` payloads; without one such payloads are refused. */
	render?: TemplateRenderer | undefined;
}

/**
 * Schema of a {@link MailAddress}.
 */
export const mailAddressSchema: z.ZodType<MailAddress, MailAddress> = z.union([
	z.email(),
	z.object({ name: z.string().min(1), address: z.email() }),
]);

/**
 * Schema of a `mail.send` payload: a template, or a subject with some body.
 */
export const mailSendSchema: z.ZodType<MailSendPayload, MailSendInput> = z
	.object({
		to: z.union([mailAddressSchema, z.array(mailAddressSchema).min(1)]),
		cc: z.array(mailAddressSchema).optional(),
		bcc: z.array(mailAddressSchema).optional(),
		from: mailAddressSchema.optional(),
		replyTo: mailAddressSchema.optional(),
		subject: z.string().min(1).optional(),
		template: z.string().min(1).optional(),
		props: z.record(z.string(), z.unknown()).optional(),
		locale: z.string().min(2).optional(),
		html: z.string().optional(),
		text: z.string().optional(),
		route: z.enum(['transactional', 'marketing']).default('transactional'),
		location: z.string().min(1).optional(),
		headers: z.record(z.string(), z.string()).optional(),
		tags: z.array(z.string().min(1)).optional(),
	})
	.refine((mail) => mail.template !== undefined || mail.html !== undefined || mail.text !== undefined, {
		message: 'A template, html or text body is required',
		path: ['template'],
	})
	.refine((mail) => mail.template !== undefined || mail.subject !== undefined, {
		message: 'A subject is required without a template',
		path: ['subject'],
	});

/**
 * `mail.send` — one message through `sendMail()` of `@novastarter/mail`, off the request.
 *
 * Delivery is retried five times with growing waits: a mail provider that is down for a minute should not lose the
 * message. Registered with the queue when this module loads, so `enqueue('mail.send', …)` is known wherever the
 * bootstrap ran.
 */
export const mailSend: JobContract<'mail.send', typeof mailSendSchema> = registerJob(
	defineJob({
		name: 'mail.send',
		schema: mailSendSchema,
		options: {
			attempts: 5,
			backoff: { type: 'exponential', delay: 5_000 },
		},
	}),
);

/**
 * Registers the contract in the job map of `@novastarter/queue`, so `enqueue('mail.send', payload)` checks the payload
 * against {@link mailSendSchema}.
 */
declare module '@novastarter/queue' {
	interface JobRegistry {
		'mail.send': typeof mailSend;
	}
}

/**
 * Turn a `mail.send` payload into a message: render the template when there is one, carry the rest over.
 *
 * @param payload - Parsed job payload.
 * @param render - Template renderer, when the app has one.
 * @returns The message for `sendMail()`.
 * @throws InvalidPayloadError for a template payload without a renderer.
 */
export const toMailMessage = async (
	payload: MailSendPayload,
	render?: TemplateRenderer | undefined,
): Promise<MailMessage> => {
	// 1. The job-only fields are split off; what remains is a message as the drivers take it
	const { template, props, locale, route, location: _location, subject, html, text, ...rest } = payload;

	let body: RenderedTemplate | { subject: string | undefined; html: string | undefined; text: string | undefined } = {
		subject,
		html,
		text,
	};

	// 2. A template is rendered here, in the job, so the request that enqueued it never waited for the renderer
	if (template !== undefined) {
		if (!render) {
			throw new InvalidPayloadError({
				reason: `Job "mail.send" got template "${template}" but no renderer is configured`,
			});
		}

		const rendered = await render(template, props ?? {}, { locale });

		// 3. An explicit subject wins over the template's
		body = { ...rendered, subject: subject ?? rendered.subject };
	}

	// 4. Bodies are only set when present, so a driver can tell "no text" from "empty text"
	return {
		...rest,
		subject: body.subject ?? '',
		...(body.html !== undefined ? { html: body.html } : {}),
		...(body.text !== undefined ? { text: body.text } : {}),
		category: route,
	};
};

/**
 * Build the handler of the `mail.send` job — what the bootstrap registers with `registerJobHandlers()`.
 *
 * A failing send throws, so the queue retries by the contract's rules (five tries with growing waits); `sendMail()`
 * already fell back down the location chain before that.
 *
 * @param options - Renderer.
 * @returns The handler.
 */
export const createMailSendHandler = (options: MailSendHandlerOptions = {}): JobHandler<typeof mailSend> => {
	// 1. The options are captured here, so the bootstrap registers a ready-made handler and a test can hand in its
	//    own renderer
	return async (payload: MailSendPayload): Promise<void> => {
		// 1. The template is rendered and the message sent inside the job, so a failure of either is retried
		const message = await toMailMessage(payload, options.render);

		await sendMail(message, { location: payload.location });
	};
};
