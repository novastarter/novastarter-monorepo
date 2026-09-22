import { useEmitter } from '@novastarter/emitter';
import { ErrorCode, isNovastarterError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { DEFAULT_LOCATION, toError } from '@novastarter/utils';
import type { PaymentsEvent, WebhookHeaders } from '../types.js';
import { usePayments } from './use-payments.js';

/**
 * Filter event a verified webhook event passes through before it is handed to the application; a handler may change
 * it or return `null` to drop it.
 *
 * @defaultValue `payments.webhook`
 */
export const PAYMENTS_WEBHOOK_FILTER = 'payments.webhook';

/**
 * Action event after a webhook delivery verified, was one the kit tracks and passed the filter.
 *
 * @defaultValue `payments.received`
 */
export const PAYMENTS_RECEIVED_EVENT = 'payments.received';

/**
 * Action event after a webhook delivery failed to verify or to parse.
 *
 * @defaultValue `payments.failed`
 */
export const PAYMENTS_FAILED_EVENT = 'payments.failed';

/**
 * Per-call overrides of {@link handleWebhook}.
 */
export interface PaymentsWebhookOptions {
	/** Verify against this location; {@link DEFAULT_LOCATION} unless given. */
	location?: string | undefined;
}

/**
 * Verify a webhook delivery through a payments location and answer the normalised event.
 *
 * The one entry point for incoming webhooks, on the `PaymentsManager` of `usePayments()`. What it does for every
 * delivery:
 *
 * 1. Resolves the location: the one asked for, else {@link DEFAULT_LOCATION}.
 * 2. Has the driver verify the signature and normalise the payload. A delivery that does not verify is logged,
 *    reported as `payments.failed` and rethrown as is, so a route answers 400 or 401 from the error's status; any
 *    other failure travels as the cause of a plain `Error`.
 * 3. Answers `null` silently for a verified event the kit does not track.
 * 4. Runs the event through the `payments.webhook` filter, where a handler may rewrite it or veto it with `null`.
 * 5. Emits `payments.received` with the event under `payload` and returns it.
 *
 * Acting on the event — applying it once by `event.id`, updating the organization — is the application's job.
 *
 * @param rawBody - The request body exactly as received; the signature is computed over these bytes.
 * @param headers - The request headers, lower-cased names.
 * @param options - The location to verify against.
 * @returns The event, or `null` when the delivery is not one the application acts on.
 * @throws InvalidPayloadError when the signature is missing or the body unreadable.
 * @throws InvalidCredentialsError when the signature is wrong.
 * @throws Error when the location does not exist, or when the driver failed for any other reason (the cause).
 * @example
 * ```ts
 * export async function POST(request: Request) {
 * 	const event = await handleWebhook(await request.text(), Object.fromEntries(request.headers));
 *
 * 	if (event) await applyPaymentsEvent(event);
 *
 * 	return new Response(null, { status: 200 });
 * }
 * ```
 */
export const handleWebhook = async (
	rawBody: string,
	headers: WebhookHeaders,
	options: PaymentsWebhookOptions = {},
): Promise<PaymentsEvent | null> => {
	const manager = usePayments();
	const logger = useLogger();

	// 1. One location, named or the default; a name nobody registered is a configuration mistake worth naming
	const location = options.location ?? DEFAULT_LOCATION;

	if (!manager.hasLocation(location)) {
		throw new Error(`Payments location "${location}" doesn't exist.`);
	}

	let parsed: PaymentsEvent | null;

	try {
		parsed = await manager.location(location).parseWebhook(rawBody, headers);
	} catch (error) {
		// 2. A delivery that does not verify is the kit's own answer — 400 or 401 — and passes through as is; the
		//    route maps the status. Reported before rethrowing, so a forged or broken delivery is visible to listeners
		if (
			isNovastarterError(error, ErrorCode.InvalidPayload) ||
			isNovastarterError(error, ErrorCode.InvalidCredentials)
		) {
			logger.warn(`Payments location "${location}" rejected a webhook (${error.code})`);
			useEmitter().emitAction(PAYMENTS_FAILED_EVENT, { location, reason: error.code });

			throw error;
		}

		// 3. Anything else is the provider's SDK or the driver failing; the driver's error travels as the cause. Pino
		//    takes a non-object first argument for the message, so a driver rejecting with a string would replace the
		//    line and drop the location; `toError` keeps both
		logger.warn(toError(error), `Payments location "${location}" failed to parse a webhook`);
		useEmitter().emitAction(PAYMENTS_FAILED_EVENT, { location, reason: 'error' });

		throw new Error(`Payments location "${location}" failed to parse a webhook`, { cause: error });
	}

	// 4. A verified event the kit does not track is neither an error nor news: the route still answers 200
	if (!parsed) return null;

	// 5. A filter handler may rewrite the event or veto it; vetoed, the route still answers 200
	const event = await useEmitter().emitFilter<PaymentsEvent | null>(PAYMENTS_WEBHOOK_FILTER, parsed, {
		location,
		provider: parsed.provider,
		type: parsed.type,
	});

	if (!event) return null;

	// 6. The event goes under `payload`: the emitter spreads the meta over `{ event: name }`, so a key named `event`
	//    would overwrite the event name
	useEmitter().emitAction(PAYMENTS_RECEIVED_EVENT, {
		location,
		id: event.id,
		type: event.type,
		provider: event.provider,
		occurredAt: event.occurredAt,
		payload: event,
	});

	return event;
};
