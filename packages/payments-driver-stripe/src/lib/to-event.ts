import type { CompletedCheckout, PaymentsEvent } from '@novastarter/payments';
import type Stripe from 'stripe';
import { fromUnix } from './from-unix.js';
import { idOf } from './id-of.js';
import { toInvoice } from './to-invoice.js';
import { toSubscription } from './to-subscription.js';

/**
 * The driver's name, as events carry it.
 *
 * @defaultValue `stripe`
 */
export const PROVIDER = 'stripe';

/**
 * A completed Stripe checkout session as the kit sees it.
 *
 * @param session - Stripe's.
 * @returns The checkout, with the subscription it created when Stripe put it on the session.
 */
export const toCompletedCheckout = (session: Stripe.Checkout.Session): CompletedCheckout => ({
	id: session.id,
	customerId: idOf(session.customer) ?? '',
	subscriptionId: idOf(session.subscription),
	metadata: session.metadata ?? {},
});

/**
 * A verified Stripe event as the kit's event, or `null` for one the kit does not act on.
 *
 * - `checkout.session.completed` and `checkout.session.async_payment_succeeded` (a delayed payment method that
 *   settled) → `checkout.completed`, for subscription checkouts only.
 * - `customer.subscription.created` → `subscription.created`; `customer.subscription.updated`, `.paused` and
 *   `.resumed` → `subscription.updated`; `customer.subscription.deleted` → `subscription.deleted`.
 * - `invoice.paid` → `invoice.paid`; `invoice.payment_failed` → `invoice.failed`.
 *
 * Everything else — trial reminders, pending updates, payment-method events — is verified and dropped.
 *
 * @param event - The event `constructEvent` handed back.
 * @returns The normalised event, or `null`.
 */
export const toEvent = (event: Stripe.Event): PaymentsEvent | null => {
	// 1. What every event shares: Stripe's event id, the driver name, when it happened, the raw event
	const base = { id: event.id, provider: PROVIDER, occurredAt: fromUnix(event.created) ?? new Date(), raw: event };

	// 2. One branch per Stripe event type the kit acts on; everything else is dropped
	switch (event.type) {
		case 'checkout.session.completed':
		case 'checkout.session.async_payment_succeeded':
			// 3. One-off payments are not subscriptions; the kit's billing is subscriptions only
			if (event.data.object.mode !== 'subscription') return null;

			return { ...base, type: 'checkout.completed', checkout: toCompletedCheckout(event.data.object) };

		case 'customer.subscription.created':
			return { ...base, type: 'subscription.created', subscription: toSubscription(event.data.object) };

		case 'customer.subscription.updated':
		case 'customer.subscription.paused':
		case 'customer.subscription.resumed':
			return { ...base, type: 'subscription.updated', subscription: toSubscription(event.data.object) };

		case 'customer.subscription.deleted':
			return { ...base, type: 'subscription.deleted', subscription: toSubscription(event.data.object) };

		case 'invoice.paid':
			return { ...base, type: 'invoice.paid', invoice: toInvoice(event.data.object) };

		case 'invoice.payment_failed':
			return { ...base, type: 'invoice.failed', invoice: toInvoice(event.data.object) };

		default:
			return null;
	}
};
