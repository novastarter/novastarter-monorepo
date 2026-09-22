import type { Invoice, InvoiceStatus } from '@novastarter/payments';
import type { LsResource, LsSubscriptionInvoiceAttributes } from '../types.js';

/**
 * How a subscription invoice's status reads as the kit's: a refund does not unpay an invoice.
 *
 * @defaultValue `pending` → `open`, `paid`, `refunded` → `paid`, `void`
 */
export const INVOICE_STATUS: Record<string, InvoiceStatus> = {
	pending: 'open',
	paid: 'paid',
	refunded: 'paid',
	void: 'void',
};

/**
 * A Lemon Squeezy subscription invoice as the kit's invoice.
 *
 * Amounts are in the currency's minor unit already. An invoice is paid in full or not at all, so `amountPaid` /
 * `amountDue` follow the status; a paid invoice is taken as paid when it was created — Lemon Squeezy charges as it
 * issues it. `invoice_url` is the hosted invoice; there is no separate PDF link.
 *
 * @param invoice - Lemon Squeezy's.
 * @returns The normalised invoice.
 */
export const toInvoice = (invoice: LsResource<LsSubscriptionInvoiceAttributes>): Invoice => {
	// 1. An unknown status reads as open: the safer default, since an open invoice is still awaiting payment
	const attributes = invoice.attributes;
	const status = INVOICE_STATUS[attributes.status] ?? 'open';
	const paid = status === 'paid';

	// 2. The amounts follow the status: all or nothing, with a void invoice owing nothing. The provider sends the
	//    currency in upper case, while the kit's contract reads it in lower case
	return {
		id: invoice.id,
		number: null,
		customerId: String(attributes.customer_id),
		subscriptionId: String(attributes.subscription_id),
		status,
		total: { amount: attributes.total, currency: attributes.currency.toLowerCase() },
		amountPaid: paid ? attributes.total : 0,
		amountDue: paid || status === 'void' ? 0 : attributes.total,
		createdAt: new Date(attributes.created_at),
		dueAt: null,
		paidAt: paid ? new Date(attributes.created_at) : null,
		hostedUrl: attributes.urls.invoice_url,
		pdfUrl: null,
	};
};
