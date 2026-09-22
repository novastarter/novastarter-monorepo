/**
 * What kind of SMS a message is; the router picks the location chain by it.
 */
export type SmsCategory = 'transactional' | 'marketing';

/**
 * A message as the application hands it to a driver: the text as it goes out, no templates — the application
 * renders, `@novastarter/sms` sends.
 */
export interface SmsMessage {
	/** Recipient in E.164 (`+14155550123`); `sendSms()` normalises spaces, dashes and a `00` prefix away first. */
	to: string;
	/** Body of the message; the provider splits it into segments. */
	text: string;
	/**
	 * Sender: a number in E.164 or an alphanumeric sender id where the destination allows one. `sendSms()` fills the
	 * sender of the routes in when missing; a location whose provider supplies the sender itself (a Twilio messaging
	 * service) sends without one.
	 */
	from?: string | undefined;
	/** `transactional` unless given. */
	category?: SmsCategory | undefined;
	/** How long the provider keeps trying to deliver, in seconds; the provider's default unless given. */
	ttl?: number | undefined;
	/** Caller's reference the provider records when it takes one (Vonage `clientRef`); ignored otherwise. */
	reference?: string | undefined;
}

/**
 * What a driver answers after a send.
 */
export interface SmsResult {
	/** Provider's id of the message, when it hands one back. */
	messageId?: string | undefined;
	/** Provider's own status word at accept time (`queued`, `0`), when it says. */
	status?: string | undefined;
	/** Number of parts the text was split into, when the provider says. */
	segments?: number | undefined;
	/** Provider's raw response line, for the log. */
	response?: string | undefined;
}
