import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * A recipient: an address, or a name with an address.
 */
export type MailAddress = string | { name: string; address: string };

/**
 * Which mail instance a message goes through — `MAIL_ROUTE_TRANSACTIONAL` or `MAIL_ROUTE_MARKETING`.
 */
export type MailRoute = 'transactional' | 'marketing';

/**
 * What a caller passes to `mail.send`.
 *
 * Either a `template` with its `props` — rendered by `@novastarter/emails` in the handler, which also produces the
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
	/** Template name of `@novastarter/emails`, e.g. `verify-email`. */
	template?: string | undefined;
	/** The template's props. */
	props?: Record<string, unknown> | undefined;
	/** Language the template is rendered in; `en` unless given. */
	locale?: string | undefined;
	html?: string | undefined;
	text?: string | undefined;
	/** `transactional` unless given. */
	route?: MailRoute | undefined;
	/** A mail instance by name, overriding the route. */
	instance?: string | undefined;
	headers?: Record<string, string> | undefined;
	/** Labels the provider records (Resend tags, SendGrid categories). */
	tags?: string[] | undefined;
}

/**
 * What the `mail.send` handler receives: the input with the defaults applied.
 */
export interface MailSendPayload extends Omit<MailSendInput, 'route'> {
	route: MailRoute;
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
		instance: z.string().min(1).optional(),
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
 * `mail.send` — one message through `@novastarter/mail`.
 *
 * Delivery is retried five times with growing waits: a mail provider that is down for a minute should not lose the
 * message.
 */
export const mailSend: JobContract<'mail.send', typeof mailSendSchema> = defineJob({
	name: 'mail.send',
	schema: mailSendSchema,
	options: {
		attempts: 5,
		backoff: { type: 'exponential', delay: 5_000 },
	},
});
