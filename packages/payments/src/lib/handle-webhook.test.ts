/**
 * Tests of `payments/lib/handle-webhook` on fake drivers registered through `usePayments()`.
 *
 * `@novastarter/logger` and `@novastarter/emitter` are mocked.
 */
import { useEmitter } from '@novastarter/emitter';
import { ErrorCode, InvalidCredentialsError, InvalidPayloadError, isNovastarterError } from '@novastarter/errors';
import { useLogger } from '@novastarter/logger';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PaymentsDriver } from '../driver.js';
import type { PaymentsEvent, WebhookHeaders } from '../types.js';
import {
	handleWebhook,
	PAYMENTS_FAILED_EVENT,
	PAYMENTS_RECEIVED_EVENT,
	PAYMENTS_WEBHOOK_FILTER,
} from './handle-webhook.js';
import { usePayments } from './use-payments.js';

vi.mock('@novastarter/logger');
vi.mock('@novastarter/emitter');

// The fake drivers join the driver map the way a driver package does, so their registrations type-check
declare module './payments-manager.js' {
	interface PaymentsDrivers {
		ok: Record<string, never>;
		untracked: Record<string, never>;
		forged: Record<string, never>;
		malformed: Record<string, never>;
		broken: Record<string, never>;
		shouting: Record<string, never>;
	}
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const emitter = { emitFilter: vi.fn(async (_event: string, payload: unknown) => payload), emitAction: vi.fn() };

/**
 * The event the `ok` driver answers for every delivery.
 */
const paidEvent: PaymentsEvent = {
	id: 'evt_1',
	type: 'invoice.paid',
	provider: 'test',
	occurredAt: new Date('2026-01-01T00:00:00Z'),
	raw: {},
	invoice: {
		id: 'in_1',
		number: 'INV-1',
		customerId: 'cus_1',
		subscriptionId: 'sub_1',
		status: 'paid',
		total: { amount: 1000, currency: 'usd' },
		amountPaid: 1000,
		amountDue: 0,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		dueAt: null,
		paidAt: new Date('2026-01-01T00:00:00Z'),
		hostedUrl: null,
		pdfUrl: null,
	},
};

/**
 * A driver whose `parseWebhook` answers, or throws, what the test asks for; the rest of the contract is never called
 * and left off, hence the cast.
 *
 * @param parse - What `parseWebhook` does.
 * @returns A driver class for `registerDriver`.
 */
const driverParsing = (parse: () => Promise<PaymentsEvent | null>): new () => PaymentsDriver =>
	class {
		/**
		 * Answer what the test asked for.
		 *
		 * @returns The scripted event.
		 */
		parseWebhook(): Promise<PaymentsEvent | null> {
			return parse();
		}
	} as unknown as new () => PaymentsDriver;

const headers: WebhookHeaders = { 'stripe-signature': 't=1,v1=abc' };

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue(logger as never);
	vi.mocked(useEmitter).mockReturnValue(emitter as never);

	const payments = usePayments();

	payments.registerDriver(
		'ok',
		driverParsing(async () => paidEvent),
	);

	payments.registerDriver(
		'untracked',
		driverParsing(async () => null),
	);

	payments.registerDriver(
		'forged',
		driverParsing(async () => {
			throw new InvalidCredentialsError();
		}),
	);

	payments.registerDriver(
		'malformed',
		driverParsing(async () => {
			throw new InvalidPayloadError({ reason: 'No signature header' });
		}),
	);

	payments.registerDriver(
		'broken',
		driverParsing(async () => {
			throw new Error('SDK exploded');
		}),
	);

	payments.registerDriver(
		'shouting',
		driverParsing(async () => {
			throw 'SDK exploded';
		}),
	);

	payments.registerLocation('default', { driver: 'ok', options: {} });
	payments.registerLocation('untracked', { driver: 'untracked', options: {} });
	payments.registerLocation('forged', { driver: 'forged', options: {} });
	payments.registerLocation('malformed', { driver: 'malformed', options: {} });
	payments.registerLocation('broken', { driver: 'broken', options: {} });
	payments.registerLocation('shouting', { driver: 'shouting', options: {} });
});

afterEach(() => {
	usePayments.reset();
	vi.clearAllMocks();
});

describe('handleWebhook', () => {
	test('Verifies through the default location, filters the event and reports it', async () => {
		const event = await handleWebhook('{}', headers);

		expect(event).toBe(paidEvent);

		expect(emitter.emitFilter).toHaveBeenCalledWith(PAYMENTS_WEBHOOK_FILTER, paidEvent, {
			location: 'default',
			provider: 'test',
			type: 'invoice.paid',
		});

		expect(emitter.emitAction).toHaveBeenCalledWith(PAYMENTS_RECEIVED_EVENT, {
			location: 'default',
			id: 'evt_1',
			type: 'invoice.paid',
			provider: 'test',
			occurredAt: paidEvent.occurredAt,
			payload: paidEvent,
		});
	});

	test('Verifies through the location asked for', async () => {
		// An explicit location wins over the default.
		expect(await handleWebhook('{}', headers, { location: 'untracked' })).toBeNull();
	});

	test('Names a location nobody registered', async () => {
		// A configuration mistake, not a bad delivery.
		await expect(handleWebhook('{}', headers, { location: 'nope' })).rejects.toMatchObject({
			code: ErrorCode.InvalidConfig,
			message: expect.stringContaining('The payments location "nope" doesn\'t exist'),
		});
	});

	test('Answers null silently for a verified event the kit does not track', async () => {
		// The route still acknowledges the delivery, since there is nothing to filter or report.
		expect(await handleWebhook('{}', headers, { location: 'untracked' })).toBeNull();
		expect(emitter.emitFilter).not.toHaveBeenCalled();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Answers null when a filter handler vetoes the event', async () => {
		emitter.emitFilter.mockResolvedValueOnce(null);

		expect(await handleWebhook('{}', headers)).toBeNull();
		expect(emitter.emitAction).not.toHaveBeenCalled();
	});

	test('Rethrows a wrong signature as is and reports it', async () => {
		// The kit's error passes through untouched, so the route can map its status.
		const error: unknown = await handleWebhook('{}', headers, { location: 'forged' }).catch((error: unknown) => error);

		expect(isNovastarterError(error, ErrorCode.InvalidCredentials)).toBe(true);
		expect(logger.warn).toHaveBeenCalledWith('Payments location "forged" rejected a webhook (INVALID_CREDENTIALS)');

		expect(emitter.emitAction).toHaveBeenCalledWith(PAYMENTS_FAILED_EVENT, {
			location: 'forged',
			reason: 'INVALID_CREDENTIALS',
		});
	});

	test('Rethrows a malformed delivery as is and reports it', async () => {
		const error: unknown = await handleWebhook('{}', headers, { location: 'malformed' }).catch(
			(error: unknown) => error,
		);

		expect(isNovastarterError(error, ErrorCode.InvalidPayload)).toBe(true);

		expect(emitter.emitAction).toHaveBeenCalledWith(PAYMENTS_FAILED_EVENT, {
			location: 'malformed',
			reason: 'INVALID_PAYLOAD',
		});
	});

	test('Wraps any other driver failure with the cause and reports it', async () => {
		// An SDK failure is not the delivery's fault, so it is a plain error with the driver's error as the cause.
		const error: unknown = await handleWebhook('{}', headers, { location: 'broken' }).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Payments location "broken" failed to parse a webhook');
		expect((error as Error).cause).toBeInstanceOf(Error);
		expect(logger.warn).toHaveBeenCalledWith(expect.any(Error), 'Payments location "broken" failed to parse a webhook');
		expect(emitter.emitAction).toHaveBeenCalledWith(PAYMENTS_FAILED_EVENT, { location: 'broken', reason: 'error' });
	});

	test('Logs a driver rejecting with a string as an error, keeping the location line', async () => {
		// Pino would take a bare string for the message and drop the line naming the location, so the rejection is
		// wrapped into an `Error` first.
		const error: unknown = await handleWebhook('{}', headers, { location: 'shouting' }).catch(
			(error: unknown) => error,
		);

		expect((error as Error).cause).toBe('SDK exploded');

		expect(logger.warn).toHaveBeenCalledWith(
			expect.any(Error),
			'Payments location "shouting" failed to parse a webhook',
		);

		expect((logger.warn.mock.calls[0]?.[0] as Error).cause).toBe('SDK exploded');
		expect(emitter.emitAction).toHaveBeenCalledWith(PAYMENTS_FAILED_EVENT, { location: 'shouting', reason: 'error' });
	});
});
