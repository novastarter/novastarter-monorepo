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
 * The total is the order's face value (`totalAmount`); what Polar actually collects is `dueAmount`, the total after
 * the customer's balance is applied, so `amountPaid` / `amountDue` follow `dueAmount` and `paid` — an order is paid in
 * full or not at all. Polar records no separate payment time, so a paid order is taken as paid when it was created
 * (Polar charges as it creates the order). The hosted and PDF links stay `null`: Polar renders invoices on request
 * through its customer portal.
 *
 * @param order - Polar's.
 * @returns The normalised invoice.
 */
export const toInvoice = (order: Order): Invoice => {
	// Polar's statuses map onto the kit's; one it does not know yet reads as still open rather than failing the list
	const status = ORDER_STATUS[String(order.status)] ?? 'open';

	// `dueAmount` is `totalAmount` plus the applied balance — the minor units Polar charges or will charge — so it
	// is what was paid or is owed, while the total keeps the face value the customer sees on the invoice
	const amountPaid = order.paid ? order.dueAmount : 0;
	const amountDue = order.paid ? 0 : order.dueAmount;

	// Polar keeps no payment timestamp of its own and charges as it creates the order, so creation is the best
	// reading of when a paid order was paid
	const paidAt = order.paid ? order.createdAt : null;

	return {
		id: order.id,
		number: order.invoiceNumber ?? null,
		customerId: order.customerId,
		subscriptionId: order.subscriptionId ?? null,
		status,
		total: { amount: order.totalAmount, currency: order.currency },
		amountPaid,
		amountDue,
		createdAt: order.createdAt,
		dueAt: null,
		paidAt,
		hostedUrl: null,
		pdfUrl: null,
	};
};
