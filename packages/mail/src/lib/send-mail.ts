import { useEmitter } from '@novastarter/emitter';
import { ErrorCode, InvalidPayloadError, isNovastarterError } from '@novastarter/errors';
import { type Logger, useLogger } from '@novastarter/logger';
import type { Limiter } from '@novastarter/memory';
import type { MailAddress, MailMessage, MailResult } from '../types.js';
import { resolveMailChain } from './router.js';
import { useMail } from './use-mail.js';

/**
 * Filter event a message passes through before it is sent; a handler may change it or return `null` to drop it.
 *
 * @defaultValue `mail.send`
 */
export const MAIL_SEND_FILTER = 'mail.send';

/**
 * Action event after a message was accepted by a location.
 *
 * @defaultValue `mail.sent`
 */
export const MAIL_SENT_EVENT = 'mail.sent';

/**
 * Action event after every location of the chain refused a message.
 *
 * @defaultValue `mail.failed`
 */
export const MAIL_FAILED_EVENT = 'mail.failed';

/**
 * What {@link sendMail} answers: the driver's result and which location delivered.
 */
export interface MailSendResult extends MailResult {
	location: string;
}

/**
 * Per-call overrides of {@link sendMail}.
 */
export interface MailSendOptions {
	/** Send through this location only, ignoring the routes. */
	location?: string | undefined;
}

/**
 * Send a message: fill the defaults in, route it to a chain of locations and fall back down the chain.
 *
 * The one entry point for outgoing mail, on the `MailManager` of `useMail()`. What it does for every message:
 *
 * 1. Runs the `mail.send` filter, so the app can rewrite or drop it.
 * 2. Fills `from` in from the routes and checks an object `from` has both parts.
 * 3. Trims the html line by line — some clients misbehave past 75 characters of leading whitespace.
 * 4. Picks the chain from the routes and tries each location in turn: one whose limiter is spent, or whose driver
 *    throws, is skipped for the next.
 * 5. Emits `mail.sent` with the winner, or `mail.failed` and throws when nobody took it.
 *
 * @param message - Message to send; `from` and `category` are optional.
 * @param options - Per-call overrides.
 * @returns The driver's result and the location that delivered, or `null` when a `mail.send` filter dropped the
 * message.
 * @throws InvalidPayloadError for a message without a sender, or a `from` object without name or address;
 * HitRateLimitError when every location of the chain is over its limit; Error when every location failed, the last
 * failure as `cause`, or when no location is registered.
 *
 * @example
 * ```ts
 * const result = await sendMail({
 * 	to: user.email,
 * 	subject: 'Welcome',
 * 	html,
 * 	text,
 * });
 * ```
 */
export const sendMail = async (message: MailMessage, options: MailSendOptions = {}): Promise<MailSendResult | null> => {
	const manager = useMail();
	const routes = manager.routes();
	const logger = useLogger();

	// 1. A filter handler may rewrite the message — a footer, a redirect to a test inbox — or veto it
	const filtered = await useEmitter().emitFilter<MailMessage | null>(MAIL_SEND_FILTER, message, {
		category: message.category ?? 'transactional',
	});

	if (!filtered) return null;

	// 2. The sender is completed from the routes and the html cleaned before any driver sees the message
	const prepared: MailMessage = {
		...filtered,
		from: resolveFrom(filtered.from, routes.from),
		...(typeof filtered.html === 'string' ? { html: normalizeHtml(filtered.html) } : {}),
	};

	// 3. An explicit location short-circuits the routes; otherwise the chain comes from `from` and `category`
	const chain = options.location ? [options.location] : resolveMailChain(routes, prepared, manager);

	if (chain.length === 0) {
		throw new Error('No mail location is registered');
	}

	let lastError: unknown;
	let lastLimit: unknown;
	let limited = 0;

	// 4. Down the chain: the first location with budget that accepts the message wins
	for (const location of chain) {
		const limit = await consume(location, routes.limiters?.[location], logger);

		if (limit) {
			lastLimit = limit;
			limited += 1;
			continue;
		}

		try {
			const result = await manager.location(location).send(prepared);
			const sent: MailSendResult = { ...result, location };

			useEmitter().emitAction(MAIL_SENT_EVENT, { ...sent, subject: prepared.subject, to: prepared.to });

			return sent;
		} catch (error) {
			lastError = error;
			logger.warn(error, `Mail location "${location}" failed to send "${prepared.subject}"`);
		}
	}

	// 5. Nobody took it: the reason is the limit when that is all that stood in the way, the last failure otherwise
	useEmitter().emitAction(MAIL_FAILED_EVENT, { locations: chain, subject: prepared.subject, to: prepared.to });

	if (limited === chain.length) {
		throw lastLimit;
	}

	throw new Error(`Every mail location failed (${chain.join(', ')})`, { cause: lastError });
};

/**
 * The sender of a message: the given one, or the one of the routes.
 *
 * @param from - What the message carried.
 * @param fallback - The sender of the routes.
 * @returns A full sender.
 * @throws InvalidPayloadError for an object missing name or address, or when neither the message nor the routes
 * carry a sender.
 */
const resolveFrom = (from: MailAddress | undefined, fallback: MailAddress | undefined): MailAddress => {
	// 1. The message's own sender wins; the routes only fill a gap
	const sender = from ?? fallback;

	if (sender === undefined || sender === '') {
		throw new InvalidPayloadError({ reason: 'No sender: pass "from" or register one in the mail routes' });
	}

	// 2. A half-filled object would reach the provider as `undefined <undefined>`; refuse it here, by name
	if (typeof sender === 'object' && (!sender.name || !sender.address)) {
		throw new InvalidPayloadError({ reason: 'A name and address property are required in the "from" object' });
	}

	return sender;
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
const consume = async (location: string, limiter: Limiter | undefined, logger: Logger): Promise<unknown> => {
	// 1. No limiter, no budget to spend
	if (!limiter) return undefined;

	try {
		await limiter.consume(location);

		return undefined;
	} catch (error) {
		// 2. A hit is the expected outcome of a busy location; anything else is the store failing
		if (isNovastarterError(error, ErrorCode.RequestsExceeded)) {
			logger.warn(`Mail location "${location}" is over its rate limit; trying the next one`);

			return error;
		}

		throw error;
	}
};

/**
 * Trim every line of an html body.
 *
 * Some clients act up when leading whitespace pushes lines past 75 characters.
 *
 * @param html - Rendered body.
 * @returns The same body, lines trimmed.
 */
export const normalizeHtml = (html: string): string =>
	html
		.split('\n')
		.map((line) => line.trim())
		.join('\n');
