/**
 * Tests of the `billing.sync` contract: dates on the wire, the discriminated shapes, and the unique id.
 */
import { describe, expect, test } from 'vitest';
import { getJobId } from '../lib/get-job-id.js';
import { billingSync, billingSyncSchema } from './billing.js';

const subscription = {
	id: 'sub_1',
	customerId: 'cus_1',
	status: 'active',
	priceId: 'price_1',
	productId: null,
	quantity: 2,
	interval: 'month',
	currentPeriodStart: '2026-09-10T12:00:00.000Z',
	currentPeriodEnd: new Date('2026-10-10T12:00:00.000Z'),
	cancelAtPeriodEnd: false,
	cancelAt: null,
	canceledAt: null,
	trialEnd: null,
	endedAt: null,
	metadata: { organizationId: 'org_1' },
};

describe('billing.sync', () => {
	test('Turns wire dates into dates and keeps nulls, whichever form the payload arrives in', () => {
		const parsed = billingSync.parse({
			id: 'evt_1',
			type: 'subscription.updated',
			provider: 'stripe',
			occurredAt: '2026-09-10T12:00:01.000Z',
			raw: { some: 'payload' },
			subscription,
		});

		expect(parsed.occurredAt).toStrictEqual(new Date('2026-09-10T12:00:01.000Z'));

		if (parsed.type !== 'subscription.updated') throw new Error('wrong shape');

		expect(parsed.subscription.currentPeriodStart).toStrictEqual(new Date('2026-09-10T12:00:00.000Z'));
		expect(parsed.subscription.currentPeriodEnd).toStrictEqual(new Date('2026-10-10T12:00:00.000Z'));
		expect(parsed.subscription.cancelAt).toBeNull();
	});

	test('Refuses an object that does not match its type, an unknown status and a broken date', () => {
		expect(
			billingSyncSchema.safeParse({
				id: 'e',
				type: 'invoice.paid',
				provider: 'p',
				occurredAt: new Date(),
				subscription,
			}).success,
		).toBe(false);

		expect(
			billingSyncSchema.safeParse({
				id: 'e',
				type: 'subscription.created',
				provider: 'p',
				occurredAt: new Date(),
				subscription: { ...subscription, status: 'frozen' },
			}).success,
		).toBe(false);

		expect(
			billingSyncSchema.safeParse({
				id: 'e',
				type: 'subscription.created',
				provider: 'p',
				occurredAt: 'yesterday',
				subscription,
			}).success,
		).toBe(false);

		expect(
			billingSyncSchema.safeParse({
				id: 'e',
				type: 'checkout.completed',
				provider: 'p',
				occurredAt: new Date(),
				checkout: { id: 'cs', customerId: 'c', subscriptionId: null, metadata: {} },
			}).success,
		).toBe(true);
	});

	test('Is unique by provider and event id while queued, and retried', () => {
		const payload = billingSync.parse({
			id: 'evt_1',
			type: 'invoice.paid',
			provider: 'stripe',
			occurredAt: new Date(),
			invoice: {
				id: 'in_1',
				number: null,
				customerId: 'cus_1',
				subscriptionId: 'sub_1',
				status: 'paid',
				total: { amount: 100, currency: 'usd' },
				amountPaid: 100,
				amountDue: 0,
				createdAt: new Date(),
				dueAt: null,
				paidAt: null,
				hostedUrl: null,
				pdfUrl: null,
			},
		});

		expect(getJobId(billingSync, payload, billingSync.options)).toBe('billing.sync_stripe_evt_1');
		expect(billingSync.options.attempts).toBe(5);
		expect(billingSync.queue).toBe('billing');
	});
});
