import type { MailResult } from '../types.js';

/**
 * What nodemailer's transports resolve `sendMail()` with; every transport fills a subset.
 */
export interface NodemailerInfo {
	messageId?: string | undefined;
	accepted?: (string | { address: string })[] | undefined;
	rejected?: (string | { address: string })[] | undefined;
	response?: string | undefined;
	envelope?: { to?: string[] | undefined } | undefined;
}

/**
 * Translate nodemailer's send result into a {@link MailResult}.
 *
 * Transports that do not report acceptance (sendmail, stream) get the envelope recipients as accepted: the message
 * left the process, and that is all that is known.
 *
 * @param info - nodemailer's result.
 * @returns Ours.
 * @example
 * ```ts
 * async send(message: MailMessage): Promise<MailResult> {
 * 	return toMailResult(await this.transporter.sendMail(toNodemailerMessage(message)));
 * }
 * ```
 */
export const toMailResult = (info: NodemailerInfo): MailResult => {
	// nodemailer reports recipients as strings or as address objects depending on the transport
	const toAddress = (entry: string | { address: string }): string =>
		typeof entry === 'string' ? entry : entry.address;

	// Transports without an acceptance report get the envelope: the message left the process
	return {
		messageId: info.messageId,
		accepted: (info.accepted ?? info.envelope?.to ?? []).map(toAddress),
		rejected: (info.rejected ?? []).map(toAddress),
		response: info.response,
	};
};
