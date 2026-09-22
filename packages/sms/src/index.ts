/**
 * Public entry point of `@novastarter/sms`.
 *
 * Outgoing text messages in three parts: the {@link SmsDriver} contract with the built-in `console` driver (vendor
 * SDKs live in the `@novastarter/sms-driver-*` packages), the {@link SmsManager} of {@link useSms} mapping named
 * locations to drivers and holding the routes the application registers at start-up, and {@link sendSms}, which
 * checks a message, fills the defaults in and routes it down a chain of locations.
 */
export * from './driver.js';
export * from './lib/drivers/index.js';
export * from './lib/phone-number.js';
export * from './lib/router.js';
export * from './lib/send-sms.js';
export * from './lib/sms-manager.js';
export * from './lib/use-sms.js';
export * from './types.js';
