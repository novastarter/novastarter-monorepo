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
	// 1. The fixture's session is the base; the same session arrives on several events with other statuses
	const event = fixture('checkout.session.completed');
	const object = { ...(event.data.object as Stripe.Checkout.Session), ...session };

	return { ...event, id: `evt_${type}`, type, data: { object } } as Stripe.Event;
};

describe('toCompletedCheckout', () => {
	test('Reads the session, the customer and the subscription it created', () => {
		// 1. The fixture's session carries string references; the ids are read as they are
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
		// 1. A paid subscription checkout is a purchase, with the session, the customer and the subscription
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

		// 2. The subscription's lifecycle: created, changed, over
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

		// 3. Invoices: paid, and a failed payment, whose invoice stays open with nothing paid
		expect(toEvent(fixture('invoice.paid'))).toMatchObject({ type: 'invoice.paid', invoice: { status: 'paid' } });

		expect(toEvent(fixture('invoice.payment_failed'))).toMatchObject({
			type: 'invoice.failed',
			invoice: { id: 'in_1S5abcDEF12346', status: 'open', amountPaid: 0, paidAt: null },
		});

		// 4. A trial reminder is verified and dropped
		expect(toEvent(fixture('customer.subscription.trial_will_end'))).toBeNull();

		// 5. The raw event rides along for the audit trail
		expect(toEvent(fixture('invoice.paid'))?.raw).toStrictEqual(fixture('invoice.paid'));
	});

	test('Ignores a one-off payment checkout', () => {
		// 1. Payment mode is a one-time purchase; the kit's billing is subscriptions only
		expect(toEvent(checkoutEvent('checkout.session.completed', { mode: 'payment' }))).toBeNull();
		expect(toEvent(checkoutEvent('checkout.session.async_payment_succeeded', { mode: 'payment' }))).toBeNull();
	});

	test('Announces a delayed payment once it settled, not when the session completed unpaid', () => {
		// 1. A session completed on a delayed payment method (SEPA or ACH debit, a bank transfer) is still `unpaid`;
		//    announcing it would provision a plan nobody paid for
		expect(toEvent(checkoutEvent('checkout.session.completed', { payment_status: 'unpaid' }))).toBeNull();

		// 2. The settled session arrives as `async_payment_succeeded`, `paid`: that is the one purchase announced
		expect(
			toEvent(checkoutEvent('checkout.session.async_payment_succeeded', { payment_status: 'paid' })),
		).toMatchObject({
			id: 'evt_checkout.session.async_payment_succeeded',
			type: 'checkout.completed',
			checkout: { id: 'cs_test_a1B2c3D4e5F6g7H8i9J0', subscriptionId: 'sub_1S5abcDEF123456789' },
		});

		// 3. A payment that never settled is dropped: nothing was announced, so there is nothing to undo
		expect(toEvent(checkoutEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }))).toBeNull();

		// 4. A trial needs no payment; that session is a purchase the moment it completes
		expect(
			toEvent(checkoutEvent('checkout.session.completed', { payment_status: 'no_payment_required' })),
		).toMatchObject({ type: 'checkout.completed' });
	});
});
