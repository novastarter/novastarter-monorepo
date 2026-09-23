import { sendSms, type SmsMessage } from '@novastarter/sms';
import type { NotificationChannel, NotificationDelivery } from '../../channel.js';
import type { NotificationRecipient, SmsContent } from '../../types.js';

/**
 * Options of {@link smsChannel}.
 */
export interface SmsChannelOptions {
	/** The SMS location to send through, ignoring the SMS routes; the routes decide unless given. */
	location?: string | undefined;
}

/**
 * The SMS channel: the rendered text to the user's number, through `sendSms()` of `@novastarter/sms`.
 *
 * @param options - The location to send through.
 * @returns The channel, named `sms`.
 * @example
 * ```ts
 * registerNotifications({ channels: [smsChannel()], findRecipient, render });
 * ```
 */
export const smsChannel = (options: SmsChannelOptions = {}): NotificationChannel<SmsContent> => ({
	name: 'sms',

	/**
	 * Whether the user has a number.
	 *
	 * @param recipient - Where the user can be reached.
	 * @returns `true` with a phone number.
	 */
	reaches(recipient: NotificationRecipient): boolean {
		return Boolean(recipient.phone);
	},

	/**
	 * Send the text to the user's number.
	 *
	 * @param delivery - The recipient and the rendered text.
	 * @returns Once an SMS location took it.
	 * @throws What `sendSms()` throws: a number that is not E.164, or every location failing.
	 */
	async send({ recipient, content }: NotificationDelivery<SmsContent>): Promise<void> {
		// 1. The recipient is the channel's to fill in, like the mail channel's
		const message: SmsMessage = { ...content, to: recipient.phone! };

		await sendSms(message, options.location ? { location: options.location } : {});
	},
});
