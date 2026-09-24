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
 * - `checkout.session.completed` and `checkout.session.async_payment_succeeded` → `checkout.completed`, for
 *   subscription checkouts whose `payment_status` is not `unpaid`. A delayed payment method (SEPA or ACH debit, a
 *   bank transfer) completes the session before the money moved: that `completed` is dropped, the session is
 *   announced once by `async_payment_succeeded` when it settles, and `async_payment_failed` is dropped too — nothing
 *   was announced, so there is nothing to undo.
 * - `customer.subscription.created` → `subscription.created`; `customer.subscription.updated`, `.paused` and
 *   `.resumed` → `subscription.updated`; `customer.subscription.deleted` → `subscription.deleted`.
 * - `invoice.paid` → `invoice.paid`; `invoice.payment_failed` → `invoice.failed`.
 *
 * Everything else — trial reminders, pending updates, payment-method events — is verified and dropped.
 *
 * @param event - The event `constructEvent` handed back.
 * @returns The normalised event, or `null`.
 * @throws Error for a subscription with a status the kit does not know, or without items — either means Stripe
 * changed something the mapping has to learn.
 */
export const toEvent = (event: Stripe.Event): PaymentsEvent | null => {
	const base = { id: event.id, provider: PROVIDER, occurredAt: fromUnix(event.created) ?? new Date(), raw: event };

	// Every event type the kit does not act on is dropped.
	switch (event.type) {
		case 'checkout.session.completed':
		case 'checkout.session.async_payment_succeeded':
			// The kit's billing is subscriptions only.
			if (event.data.object.mode !== 'subscription') return null;

			// `checkout.completed` means the customer paid. A session completed on a delayed payment method is still
			// `unpaid`, and announcing it would provision a plan nobody paid for; `async_payment_succeeded` carries the
			// same session as `paid` once it settled, so the purchase is announced exactly once, and a session that
			// never settles (`async_payment_failed`) is never announced.
			if (event.data.object.payment_status === 'unpaid') return null;

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
