/**
 * Public entry point of `@novastarter/sms`.
 *
 * Outgoing text messages in three parts: the {@link SmsDriver} contract with the built-in `console` driver (vendor
 * SDKs live in the `@novastarter/sms-driver-*` packages), the {@link SmsManager} of {@link useSms} mapping named
 * locations to drivers and holding the routes the application registers at start-up, and {@link sendSms}, which
 * checks a message, fills the defaults in and routes it down a chain of locations.
 */
export type { SmsDriver } from './driver.js';
export { SmsDriverConsole, type SmsDriverConsoleConfig } from './lib/drivers/index.js';
export { isPhoneNumber, normalizePhoneNumber } from './lib/phone-number.js';
export { resolveSmsChain } from './lib/router.js';
export {
	SMS_FAILED_EVENT,
	SMS_PARTIAL_DELIVERY_CODE,
	SMS_SEND_FILTER,
	SMS_SENT_EVENT,
	sendSms,
	type SmsSendOptions,
	type SmsSendResult,
} from './lib/send-sms.js';
export { SmsManager, type SmsDrivers, type SmsRoutes } from './lib/sms-manager.js';
export { useSms } from './lib/use-sms.js';
export type { SmsCategory, SmsMessage, SmsResult } from './types.js';
