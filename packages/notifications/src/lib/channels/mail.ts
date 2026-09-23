import { type MailMessage, sendMail } from '@novastarter/mail';
import type { NotificationChannel, NotificationDelivery } from '../../channel.js';
import type { MailContent, NotificationRecipient } from '../../types.js';

/**
 * Options of {@link mailChannel}.
 */
export interface MailChannelOptions {
	/** The mail location to send through, ignoring the mail routes; the routes decide unless given. */
	location?: string | undefined;
}

/**
 * The mail channel: the rendered message to the user's address, through `sendMail()` of `@novastarter/mail`.
 *
 * @param options - The location to send through.
 * @returns The channel, named `mail`.
 * @example
 * ```ts
 * registerNotifications({ channels: [mailChannel()], findRecipient, render });
 * ```
 */
export const mailChannel = (options: MailChannelOptions = {}): NotificationChannel<MailContent> => ({
	name: 'mail',

	/**
	 * Whether the user has an address.
	 *
	 * @param recipient - Where the user can be reached.
	 * @returns `true` with an email address.
	 */
	reaches(recipient: NotificationRecipient): boolean {
		return Boolean(recipient.email);
	},

	/**
	 * Send the message to the user's address.
	 *
	 * @param delivery - The recipient and the rendered message.
	 * @returns Once a mail location took it.
	 * @throws What `sendMail()` throws when every location failed.
	 */
	async send({ recipient, content }: NotificationDelivery<MailContent>): Promise<void> {
		// 1. The recipient is the channel's to fill in, so a template cannot send someone else's notification elsewhere
		const message: MailMessage = { ...content, to: recipient.email! };

		await sendMail(message, options.location ? { location: options.location } : {});
	},
});
