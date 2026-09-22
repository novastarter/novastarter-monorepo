import type { SmsMessage } from '@novastarter/sms';
import type { MessageListInstanceCreateOptions } from 'twilio/lib/rest/api/v2010/account/message.js';

/**
 * What the driver adds to every message from its location options.
 */
export interface TwilioMessageDefaults {
	/** Messaging service that picks the sender for a message without a `from` of its own. */
	messagingServiceSid?: string | undefined;
	/** URL Twilio posts delivery status updates to. */
	statusCallback?: string | undefined;
}

/**
 * Translate a message into the payload of Twilio's `messages.create()`.
 *
 * Twilio needs exactly one sender: the number or sender id of `from`, or a messaging service that picks one from its
 * own pool. The messaging service only applies when the message carries no sender, so a location can serve both a
 * campaign sending from its pool and a message that names its number.
 *
 * @param message - Ours, with the recipient already in E.164 (`sendSms()` normalises it).
 * @param defaults - The location's messaging service and status callback.
 * @returns Twilio's.
 * @throws Error when neither the message nor the location names a sender — Twilio would refuse the request.
 * @example
 * ```ts
 * await client.messages.create(toTwilioMessage(message, { messagingServiceSid: 'MG…' }));
 * ```
 */
export const toTwilioMessage = (
	message: SmsMessage,
	defaults: TwilioMessageDefaults = {},
): MessageListInstanceCreateOptions => {
	// 1. The sender of the message wins over the location's pool, so one location serves both: a campaign sending
	//    from its pool and a message that names its own number
	let sender: { from: string } | { messagingServiceSid: string };

	if (message.from) {
		sender = { from: message.from };
	} else {
		// 2. Without a sender of either kind the API answers 21603; say so by the option's name instead. Checked for
		//    truthiness on its own, the value narrows instead of needing a cast
		const messagingServiceSid = defaults.messagingServiceSid;

		if (!messagingServiceSid) {
			throw new Error('The twilio sms driver needs a "from" or a "messagingServiceSid"');
		}

		sender = { messagingServiceSid };
	}

	// 3. Optional fields are only set when present, so the request carries no `undefined` keys; `validityPeriod` is
	//    Twilio's name for how long it keeps trying, in seconds, which is what `ttl` means here
	return {
		to: message.to,
		body: message.text,
		...sender,
		...(message.ttl !== undefined ? { validityPeriod: message.ttl } : {}),
		...(defaults.statusCallback !== undefined ? { statusCallback: defaults.statusCallback } : {}),
	};
};
