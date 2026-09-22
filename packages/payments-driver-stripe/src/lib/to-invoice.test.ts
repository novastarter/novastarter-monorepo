/**
 * Tests of the Stripe invoice mapping, read from fixtures shaped like Stripe's current invoices.
 */
import { readFileSync } from 'node:fs';
import type Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { toInvoice } from './to-invoice.js';

/**
 * A fixture event's object, as the invoice the event carries.
 *
 * @param name - The Stripe event type the file is named after.
 * @returns The invoice.
 */
const fixture = (name: string): Stripe.Invoice =>
	(JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Stripe.Event).data
		.object as Stripe.Invoice;

describe('toInvoice', () => {
	test('Maps amounts, the subscription of the parent and the links', () => {
		// 1. Amounts stay in minor units; the subscription comes from `parent.subscription_details`, the links as is
		expect(toInvoice(fixture('invoice.paid'))).toStrictEqual({
			id: 'in_1S5abcDEF12345',
			number: 'A1B2C3D4-0001',
			customerId: 'cus_T1abcDEF12345',
			subscriptionId: 'sub_1S5abcDEF123456789',
			status: 'paid',
			total: { amount: 5700, currency: 'usd' },
			amountPaid: 5700,
			amountDue: 5700,
			createdAt: new Date(1791676800 * 1000),
			dueAt: null,
			paidAt: new Date(1791676805 * 1000),
			hostedUrl: 'https://invoice.stripe.com/i/acct_1/test_YWNjdF8x',
			pdfUrl: 'https://pay.stripe.com/invoice/acct_1/test_YWNjdF8x/pdf',
		});
	});

	test('Reads a draft for an invoice without a status and null for what is unset', () => {
		// 1. Stripe leaves `status` null on an invoice still being built; a draft is the honest reading
		const invoice = fixture('invoice.payment_failed');

		expect(toInvoice({ ...invoice, status: null })).toMatchObject({ status: 'draft' });

		// 2. A failed payment leaves the invoice open, unpaid and without a paid-at or a number of its own
		expect(toInvoice(invoice)).toMatchObject({ status: 'open', amountPaid: 0, paidAt: null });

		// 3. Nothing to link to, nothing to expand: the nullable fields answer null rather than empty strings
		expect(
			toInvoice({
				...invoice,
				number: null,
				hosted_invoice_url: null,
				invoice_pdf: null,
				parent: null,
				customer: null,
			}),
		).toMatchObject({ number: null, hostedUrl: null, pdfUrl: null, subscriptionId: null, customerId: '' });
	});
});
