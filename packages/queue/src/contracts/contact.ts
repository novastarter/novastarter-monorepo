import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * Payload of `contact.submitted`: what a visitor wrote on the contact page, and what the request said about them.
 */
export interface ContactSubmittedPayload {
	name: string;
	email: string;
	subject?: string | undefined;
	message: string;
	/** Language of the visitor, so the copy that goes back to them (if any) is in it. */
	locale?: string | undefined;
	/** Where the message came from — the spam trail, for the mail's footer and the audit. */
	ip?: string | undefined;
	userAgent?: string | undefined;
	/** When the form was submitted, ISO 8601. */
	receivedAt: string;
}

/**
 * Schema of a {@link ContactSubmittedPayload}.
 */
export const contactSubmittedSchema: z.ZodType<ContactSubmittedPayload, ContactSubmittedPayload> = z.object({
	name: z.string().min(1).max(200),
	email: z.email(),
	subject: z.string().max(200).optional(),
	message: z.string().min(1).max(10_000),
	locale: z.string().min(2).max(10).optional(),
	ip: z.string().max(45).optional(),
	userAgent: z.string().max(1000).optional(),
	receivedAt: z.iso.datetime(),
});

/**
 * `contact.submitted` — a message from the contact form: the handler mails it to the inbox of `MAIL_CONTACT_TO`
 * and notifies the administrators.
 *
 * Three tries: a mail transport that is down for a moment must not lose a lead. Not unique — two identical
 * messages are two messages.
 */
export const contactSubmitted: JobContract<'contact.submitted', typeof contactSubmittedSchema> = defineJob({
	name: 'contact.submitted',
	schema: contactSubmittedSchema,
	options: {
		attempts: 3,
	},
});
