/**
 * Tests of the Stripe event mapping: which Stripe events become the kit's, read from fixtures shaped like Stripe's
 * current events, and which are dropped — a session completed before its delayed payment settled among them.
 */
import type Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { fixture } from '../fixtures/index.js';
import { PROVIDER, toCompletedCheckout, toEvent } from './to-event.js';

/**
 * The checkout fixture with another event type and session fields, for the checkout events Stripe sends no fixture of.
 *
 * @param type - The Stripe event type to carry.
 * @param session - Session fields to override.
 * @returns The event, with a distinct id so it cannot pass for the fixture's own.
 */
const checkoutEvent = (type: Stripe.Event['type'], session: Partial<Stripe.Checkout.Session>): Stripe.Event => {
	// The same session arrives on several events with other statuses.
	const event = fixture('checkout.session.completed');
	const object = { ...(event.data.object as Stripe.Checkout.Session), ...session };

	return { ...event, id: `evt_${type}`, type, data: { object } } as Stripe.Event;
};

describe('toCompletedCheckout', () => {
	test('Reads the session, the customer and the subscription it created', () => {
		expect(
			toCompletedCheckout(fixture('checkout.session.completed').data.object as Stripe.Checkout.Session),
		).toStrictEqual({
			id: 'cs_test_a1B2c3D4e5F6g7H8i9J0',
			customerId: 'cus_T1abcDEF12345',
			subscriptionId: 'sub_1S5abcDEF123456789',
			metadata: { organizationId: 'org_42', planId: 'pro' },
		});
	});
});

describe('toEvent', () => {
	test('Maps the events the kit acts on and drops the rest', () => {
		expect(toEvent(fixture('checkout.session.completed'))).toMatchObject({
			id: 'evt_1S5checkout000006',
			type: 'checkout.completed',
			provider: PROVIDER,
			occurredAt: new Date(1789084800 * 1000),
			checkout: {
				id: 'cs_test_a1B2c3D4e5F6g7H8i9J0',
				customerId: 'cus_T1abcDEF12345',
				subscriptionId: 'sub_1S5abcDEF123456789',
				metadata: { organizationId: 'org_42', planId: 'pro' },
			},
		});

		expect(toEvent(fixture('customer.subscription.created'))).toMatchObject({
			type: 'subscription.created',
			subscription: { status: 'trialing', quantity: 3 },
		});

		expect(toEvent(fixture('customer.subscription.updated'))).toMatchObject({
			type: 'subscription.updated',
			subscription: { status: 'active', cancelAtPeriodEnd: true },
		});

		expect(toEvent(fixture('customer.subscription.deleted'))).toMatchObject({
			type: 'subscription.deleted',
			subscription: { status: 'canceled', endedAt: new Date(1791676800 * 1000) },
		});

		expect(toEvent(fixture('invoice.paid'))).toMatchObject({ type: 'invoice.paid', invoice: { status: 'paid' } });

		expect(toEvent(fixture('invoice.payment_failed'))).toMatchObject({
			type: 'invoice.failed',
			invoice: { id: 'in_1S5abcDEF12346', status: 'open', amountPaid: 0, paidAt: null },
		});

		expect(toEvent(fixture('customer.subscription.trial_will_end'))).toBeNull();

		expect(toEvent(fixture('invoice.paid'))?.raw).toStrictEqual(fixture('invoice.paid'));
	});

	test('Ignores a one-off payment checkout', () => {
		// The kit's billing is subscriptions only.
		expect(toEvent(checkoutEvent('checkout.session.completed', { mode: 'payment' }))).toBeNull();
		expect(toEvent(checkoutEvent('checkout.session.async_payment_succeeded', { mode: 'payment' }))).toBeNull();
	});

	test('Announces a delayed payment once it settled, not when the session completed unpaid', () => {
		// A session completed on a delayed payment method (SEPA or ACH debit, a bank transfer) is still `unpaid`;
		// announcing it would provision a plan nobody paid for.
		expect(toEvent(checkoutEvent('checkout.session.completed', { payment_status: 'unpaid' }))).toBeNull();

		expect(
			toEvent(checkoutEvent('checkout.session.async_payment_succeeded', { payment_status: 'paid' })),
		).toMatchObject({
			id: 'evt_checkout.session.async_payment_succeeded',
			type: 'checkout.completed',
			checkout: { id: 'cs_test_a1B2c3D4e5F6g7H8i9J0', subscriptionId: 'sub_1S5abcDEF123456789' },
		});

		// Nothing was announced, so there is nothing to undo.
		expect(toEvent(checkoutEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }))).toBeNull();

		// A trial needs no payment.
		expect(
			toEvent(checkoutEvent('checkout.session.completed', { payment_status: 'no_payment_required' })),
		).toMatchObject({ type: 'checkout.completed' });
	});
});
