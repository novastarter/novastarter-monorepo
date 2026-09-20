import type { Invoice, InvoiceStatus } from '@novastarter/payments';
import type { Order } from '@polar-sh/sdk/models/components/order.js';

/**
 * How an order's status reads as an invoice status: a refund does not unpay an invoice, a pending order is one still
 * open for payment.
 *
 * @defaultValue `draft`, `pending` → `open`, `paid` / `refunded` / `partially_refunded` → `paid`, `void`
 */
export const ORDER_STATUS: Record<string, InvoiceStatus> = {
	draft: 'draft',
	pending: 'open',
	paid: 'paid',
	refunded: 'paid',
	partially_refunded: 'paid',
	void: 'void',
};

/**
 * A Polar order as the kit's invoice — Polar has orders where Stripe has invoices, one per charge.
 *
 * An order is paid in full or not at all, so `amountPaid` / `amountDue` follow `paid`; Polar records no separate
 * payment time, so a paid order is taken as paid when it was created (Polar charges as it creates the order). The
 * hosted and PDF links stay `null`: Polar renders invoices on request through its customer portal.
 *
 * @param order - Polar's.
 * @returns The normalised invoice.
 */
export const toInvoice = (order: Order): Invoice => ({
	id: order.id,
	number: order.invoiceNumber ?? null,
	customerId: order.customerId,
	subscriptionId: order.subscriptionId ?? null,
	status: ORDER_STATUS[String(order.status)] ?? 'open',
	total: { amount: order.totalAmount, currency: order.currency },
	amountPaid: order.paid ? order.totalAmount : 0,
	amountDue: order.paid ? 0 : order.totalAmount,
	createdAt: order.createdAt,
	dueAt: null,
	paidAt: order.paid ? order.createdAt : null,
	hostedUrl: null,
	pdfUrl: null,
});
