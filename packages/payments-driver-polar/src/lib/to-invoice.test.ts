/**
 * Tests of `to-invoice`: how a Polar order becomes the kit's invoice, read from the `order.paid` fixture through the
 * SDK's own parser.
 */
import type { Order } from '@polar-sh/sdk/models/components/order.js';
import { describe, expect, test } from 'vitest';
import { parsed } from '../fixtures/index.js';
import { toInvoice } from './to-invoice.js';

/**
 * The paid order of the fixture, the way the SDK hands it to the driver.
 *
 * @returns The order.
 */
const paidOrder = (): Order => {
	// The fixture is signed and parsed by the SDK, so the order carries exactly the shape the driver sees
	const event = parsed('order.paid');

	return event.type === 'order.paid' ? event.data : (undefined as never);
};

describe('toInvoice', () => {
	test('Maps a paid order as a paid invoice', () => {
		// A paid order is paid in full: the whole due amount is paid, nothing is due, paid when created
		expect(toInvoice(paidOrder())).toStrictEqual({
			id: 'f0e1d2c3-7777-4a77-9c77-000000000007',
			number: 'NOVA-0001',
			customerId: 'c3d2e1f0-2222-4b22-8d22-000000000002',
			subscriptionId: 'd9c8b7a6-5555-4e55-9a55-000000000005',
			status: 'paid',
			total: { amount: 9500, currency: 'usd' },
			amountPaid: 9500,
			amountDue: 0,
			createdAt: new Date('2026-10-10T12:00:00Z'),
			dueAt: null,
			paidAt: new Date('2026-10-10T12:00:00Z'),
			hostedUrl: null,
			pdfUrl: null,
		});
	});

	test('Takes the paid and due amounts from what Polar collects, not the face value', () => {
		// A customer balance applied to the order lowers what Polar charges below the total; the total stays the
		// invoice's face value while the paid amount is what was actually collected
		const withBalance = { ...paidOrder(), appliedBalanceAmount: -2000, dueAmount: 7500 };

		expect(toInvoice(withBalance)).toMatchObject({
			status: 'paid',
			total: { amount: 9500, currency: 'usd' },
			amountPaid: 7500,
			amountDue: 0,
		});

		// The same order still pending owes what Polar will collect, and nothing is paid yet
		const pending = { ...withBalance, status: 'pending' as const, paid: false };

		expect(toInvoice(pending)).toMatchObject({
			status: 'open',
			total: { amount: 9500, currency: 'usd' },
			amountPaid: 0,
			amountDue: 7500,
			paidAt: null,
		});
	});

	test('Reads a status it does not know as still open', () => {
		// A refund does not unpay an invoice; a status Polar adds later is read as open rather than failing the list
		expect(toInvoice({ ...paidOrder(), status: 'refunded' as const })).toMatchObject({ status: 'paid' });
		expect(toInvoice({ ...paidOrder(), status: 'disputed' as never, paid: false })).toMatchObject({ status: 'open' });
	});
});
