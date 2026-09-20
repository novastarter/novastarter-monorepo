import type { Invoice, InvoiceStatus } from '@novastarter/payments';
import type Stripe from 'stripe';
import { fromUnix } from './from-unix.js';
import { idOf } from './id-of.js';

/**
 * A Stripe invoice as the kit sees it.
 *
 * Amounts are Stripe's minor units as they are; the subscription comes from `parent.subscription_details`, where
 * API version 2025-03-31 moved it.
 *
 * @param invoice - Stripe's.
 * @returns The normalised invoice.
 */
export const toInvoice = (invoice: Stripe.Invoice): Invoice => ({
	id: invoice.id,
	number: invoice.number ?? null,
	customerId: idOf(invoice.customer) ?? '',
	subscriptionId: idOf(invoice.parent?.subscription_details?.subscription),
	// 1. `status` is nullable on Stripe's side for invoices still being built; a draft is the honest reading
	status: (invoice.status ?? 'draft') as InvoiceStatus,
	total: { amount: invoice.total, currency: invoice.currency },
	amountPaid: invoice.amount_paid,
	amountDue: invoice.amount_due,
	createdAt: fromUnix(invoice.created) ?? new Date(0),
	dueAt: fromUnix(invoice.due_date),
	paidAt: fromUnix(invoice.status_transitions?.paid_at),
	hostedUrl: invoice.hosted_invoice_url ?? null,
	pdfUrl: invoice.invoice_pdf ?? null,
});
