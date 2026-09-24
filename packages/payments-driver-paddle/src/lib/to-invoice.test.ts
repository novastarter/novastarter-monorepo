/**
 * Tests of `to-invoice`: how a Paddle transaction — from the API or a notification — becomes the kit's invoice, read
 * from the fixtures in the shape of Paddle's notification payloads.
 */
import { describe, expect, test } from 'vitest';
import { parsed } from '../fixtures/index.js';
import { toInvoice } from './to-invoice.js';

describe('toInvoice', () => {
	test('A completed transaction is a paid invoice, paid when its payment was captured', () => {
		// The completed fixture has a captured payment, so the totals, the number and the dates all have a value
		expect(toInvoice(parsed('transaction.completed').data as never)).toStrictEqual({
			id: 'txn_01h7zcgmdc8n1v3ypn6pkqtb3t',
			number: '325-10001',
			customerId: 'ctm_01h7zcgmdc8n1v3ypn6pkqtb3r',
			subscriptionId: 'sub_01h7zcgmdc8n1v3ypn6pkqtb3s',
			status: 'paid',
			total: { amount: 10440, currency: 'usd' },
			amountPaid: 10440,
			amountDue: 0,
			createdAt: new Date('2026-09-01T09:59:50.000Z'),
			dueAt: null,
			paidAt: new Date('2026-09-01T10:00:03.000Z'),
			hostedUrl: null,
			pdfUrl: null,
		});
	});

	test('A past-due transaction is open, its balance due', () => {
		// Nothing was captured, so the whole grand total is still due and there is no paid date
		expect(toInvoice(parsed('transaction.payment_failed').data as never)).toMatchObject({
			status: 'open',
			amountPaid: 0,
			amountDue: 10440,
			paidAt: null,
		});
	});
});
