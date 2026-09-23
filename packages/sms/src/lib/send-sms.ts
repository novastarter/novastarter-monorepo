import { useEmitter } from '@novastarter/emitter';
import { ErrorCode, InvalidPayloadError, isNovastarterError } from '@novastarter/errors';
import { type Logger, useLogger } from '@novastarter/logger';
import type { LimiterDriver } from '@novastarter/memory';
import { toError } from '@novastarter/utils';
import type { SmsMessage, SmsResult } from '../types.js';
import { isPhoneNumber, normalizePhoneNumber } from './phone-number.js';
import { resolveSmsChain } from './router.js';
import { useSms } from './use-sms.js';

/**
 * Filter event a message passes through before it is sent; a handler may change it or return `null` to drop it.
 *
 * @defaultValue `sms.send`
 */
export const SMS_SEND_FILTER = 'sms.send';

/**
 * Action event after a message was accepted by a location.
 *
 * @defaultValue `sms.sent`
 */
export const SMS_SENT_EVENT = 'sms.sent';

/**
 * Action event after every location of the chain refused a message.
 *
 * @defaultValue `sms.failed`
 */
export const SMS_FAILED_EVENT = 'sms.failed';

/**
 * Error code of a partial delivery: a driver throws it when the provider accepted some parts of a long text and
 * refused the rest.
 *
 * A partial delivery is not a failed location. The accepted parts already went out and are billed, so `sendSms()`
 * rethrows the error as-is instead of falling back to the next location, which would send those parts again. A driver
 * reports it with this code — the Vonage driver does, through `SmsPartialDeliveryError` of
 * `@novastarter/sms-driver-vonage` — and the chain matches the code structurally with `isNovastarterError`, which
 * keeps `@novastarter/sms` free of any driver dependency.
 *
 * @defaultValue `SMS_PARTIAL_DELIVERY`
 */
export const SMS_PARTIAL_DELIVERY_CODE = 'SMS_PARTIAL_DELIVERY';

/**
 * What {@link sendSms} answers: the driver's result and which location delivered.
 */
export interface SmsSendResult extends SmsResult {
	location: string;
}

/**
 * Per-call overrides of {@link sendSms}.
 */
export interface SmsSendOptions {
	/** Send through this location only, ignoring the routes. */
	location?: string | undefined;
}

/**
 * Send a message: check it, fill the defaults in, route it to a chain of locations and fall back down the chain.
 *
 * The one entry point for outgoing SMS, on the `SmsManager` of `useSms()`. What it does for every message:
 *
 * 1. Normalises the recipient and refuses one that is not E.164 afterwards, or a blank text.
 * 2. Runs the `sms.send` filter, so the app can rewrite or drop it. The rewrite is checked the same way, so a
 *    handler that redirected to a malformed test number is refused here rather than by a provider.
 * 3. Fills `from` in from the routes. A message may still go out without one: a location whose provider supplies the
 *    sender itself (a Twilio messaging service) takes it, a driver that needs one refuses it by name.
 * 4. Picks the chain from the routes — or the one location `options.location` names, which has to be registered —
 *    and tries each location in turn: one whose limiter is spent, or whose driver throws, is skipped for the next.
 *    The one exception is a partial delivery — a driver error carrying {@link SMS_PARTIAL_DELIVERY_CODE}: the parts
 *    the provider accepted already went out, so re-sending through the next location would deliver them again, and
 *    the error is rethrown as-is instead.
 * 5. Emits `sms.sent` with the winner, or `sms.failed` and throws when nobody took it.
 *
 * @param message - Message to send; `from` and `category` are optional.
 * @param options - Per-call overrides.
 * @returns The driver's result and the location that delivered, or `null` when an `sms.send` filter dropped the
 * message.
 * @throws InvalidPayloadError for a recipient that is not E.164 or a blank text — as it came in, or as an `sms.send`
 * handler rewrote it; Error when `options.location` names a location nobody registered, before anything is sent;
 * HitRateLimitError when every location of the chain is over its limit; the driver's partial-delivery error as-is,
 * with {@link SMS_PARTIAL_DELIVERY_CODE}, when a location delivered the message in part — the chain does not fall
 * back, the delivered parts already went out; Error when every location failed, the last failure as `cause`, or when
 * no location is registered.
 *
 * @example
 * ```ts
 * const result = await sendSms({
 * 	to: user.phone,
 * 	text: `Your code is ${code}`,
 * });
 * // → { location: 'main', messageId: 'SM…', status: 'queued' }
 * ```
 */
export const sendSms = async (message: SmsMessage, options: SmsSendOptions = {}): Promise<SmsSendResult | null> => {
	const manager = useSms();
	const routes = manager.routes();
	const logger = useLogger();

	// 1. The recipient and the text are checked before any work is done, so a broken message never reaches a handler
	const incoming = normalize(message);

	// 2. A filter handler may rewrite the message — a prefix, a redirect to a test phone — or veto it
	const filtered = await useEmitter().emitFilter<SmsMessage | null>(SMS_SEND_FILTER, incoming, {
		category: incoming.category ?? 'transactional',
	});

	if (!filtered) return null;

	// 3. The rewrite is checked like the original, and the sender completed from the routes before any driver sees
	//    the message; a sender stays optional, since a provider may supply it from the location's own settings
	const from = filtered.from ?? routes.from;

	const prepared: SmsMessage = {
		...normalize(filtered),
		...(from !== undefined ? { from } : {}),
	};

	// 4. An explicit location short-circuits the routes; otherwise the chain comes from the category. A name nobody
	//    registered is a configuration mistake, named here rather than logged as a delivery failure below
	if (options.location && !manager.hasLocation(options.location)) {
		throw new Error(`Sms location "${options.location}" doesn't exist.`);
	}

	const chain = options.location ? [options.location] : resolveSmsChain(routes, prepared, manager);

	if (chain.length === 0) {
		throw new Error('No sms location is registered');
	}

	let lastError: unknown;
	let lastLimit: unknown;
	let limited = 0;

	// 5. Down the chain: the first location with budget that accepts the message wins
	for (const location of chain) {
		const limit = await consume(location, routes.limiters?.[location], logger);

		if (limit) {
			lastLimit = limit;
			limited += 1;
			continue;
		}

		try {
			const result = await manager.location(location).send(prepared);
			const sent: SmsSendResult = { ...result, location };

			useEmitter().emitAction(SMS_SENT_EVENT, { ...sent, to: prepared.to });

			return sent;
		} catch (error) {
			// 6. A partial delivery is not a failed location: the parts the provider accepted already went out and are
			//    billed, so the error passes to the caller untouched — the next location would send those parts again
			if (isNovastarterError(error, SMS_PARTIAL_DELIVERY_CODE)) {
				throw error;
			}

			// 7. pino takes a non-object first argument as the message, so a driver rejecting with a string would replace
			//    the line and drop the location; `toError` keeps both
			lastError = error;
			logger.warn(toError(error), `Sms location "${location}" failed to send to ${prepared.to}`);
		}
	}

	// 8. Nobody took it: the reason is the limit when that is all that stood in the way, the last failure otherwise
	useEmitter().emitAction(SMS_FAILED_EVENT, { locations: chain, to: prepared.to });

	if (limited === chain.length) {
		throw lastLimit;
	}

	throw new Error(`Every sms location failed (${chain.join(', ')})`, { cause: lastError });
};

/**
 * The message with its recipient in E.164, refused when it cannot be.
 *
 * @param message - The message, as it came in or as an `sms.send` handler rewrote it.
 * @returns The same message, `to` normalised.
 * @throws InvalidPayloadError for a recipient that is not E.164 after clean-up, or a text that is not a string or is
 * whitespace only.
 */
const normalize = (message: SmsMessage): SmsMessage => {
	// 1. Separators and the `00` prefix go; what is left has to be E.164, since every provider refuses anything else
	//    and a bare national number would be a guess at its country
	const to = typeof message.to === 'string' ? normalizePhoneNumber(message.to) : '';

	if (!isPhoneNumber(to)) {
		throw new InvalidPayloadError({ reason: `The recipient "${String(message.to)}" is not a phone number in E.164` });
	}

	// 2. An empty text is refused as the payload's fault: a provider would either refuse it or bill for nothing
	if (typeof message.text !== 'string' || !message.text.trim()) {
		throw new InvalidPayloadError({ reason: 'The SMS message has no text' });
	}

	return { ...message, to };
};

/**
 * Take one point from a location's budget.
 *
 * @param location - Location name, which is also the limiter's key.
 * @param limiter - The location's limiter, when the routes give it one.
 * @param logger - Where a hit is reported.
 * @returns The limiter's error when the location is over its limit; `undefined` otherwise, including for locations
 * without a limiter.
 * @throws Whatever a broken limiter store throws — a limit that cannot be checked is not silently ignored.
 */
const consume = async (location: string, limiter: LimiterDriver | undefined, logger: Logger): Promise<unknown> => {
	// 1. No limiter, no budget to spend
	if (!limiter) return undefined;

	try {
		await limiter.consume(location);

		return undefined;
	} catch (error) {
		// 2. A hit is the expected outcome of a busy location; anything else is the store failing
		if (isNovastarterError(error, ErrorCode.RequestsExceeded)) {
			logger.warn(`Sms location "${location}" is over its rate limit; trying the next one`);

			return error;
		}

		throw error;
	}
};
