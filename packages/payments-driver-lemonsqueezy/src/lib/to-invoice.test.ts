/**
 * Tests of `to-invoice`: how a Lemon Squeezy subscription invoice, read from fixtures in the shape of its documented
 * payloads, becomes the kit's invoice — the status, the all-or-nothing amounts, the hosted link.
 */
import { describe, expect, test } from 'vitest';
import { fixture } from '../fixtures/index.js';
import type { LsSubscriptionInvoiceAttributes, LsWebhookPayload } from '../types.js';
import { toInvoice } from './to-invoice.js';

/**
 * The subscription invoice of a fixture, named after the Lemon Squeezy event it carries.
 *
 * @param name - The fixture.
 * @returns The invoice resource under `data`.
 */
const invoiceOf = (name: string): LsWebhookPayload<LsSubscriptionInvoiceAttributes>['data'] =>
	fixture<LsSubscriptionInvoiceAttributes>(name).data;

describe('toInvoice', () => {
	test('A paid subscription invoice, with its hosted link', () => {
		// 1. Every field of the kit's shape: a paid invoice owes nothing, was paid when issued, and has no PDF link
		expect(toInvoice(invoiceOf('subscription_payment_success'))).toStrictEqual({
			id: '9001',
			number: null,
			customerId: '987',
			subscriptionId: '3001',
			status: 'paid',
			total: { amount: 10440, currency: 'usd' },
			amountPaid: 10440,
			amountDue: 0,
			createdAt: new Date('2026-10-01T10:00:00.000000Z'),
			dueAt: null,
			paidAt: new Date('2026-10-01T10:00:00.000000Z'),
			hostedUrl: 'https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/9001?signature=s',
			pdfUrl: null,
		});

		// 2. A pending invoice is the kit's open one: the whole total still due, nothing paid, no paid date
		expect(toInvoice(invoiceOf('subscription_payment_failed'))).toMatchObject({
			status: 'open',
			amountPaid: 0,
			amountDue: 10440,
			paidAt: null,
		});
	});

	test('A partially refunded invoice stays paid', () => {
		// 1. A partial refund does not unpay the invoice: the whole total counts as paid, nothing is due
		const invoice = invoiceOf('subscription_payment_success');
		const refunded = { ...invoice, attributes: { ...invoice.attributes, status: 'partial_refund' as const } };

		expect(toInvoice(refunded)).toMatchObject({
			status: 'paid',
			amountPaid: 10440,
			amountDue: 0,
			paidAt: new Date('2026-10-01T10:00:00.000000Z'),
		});
	});
});
