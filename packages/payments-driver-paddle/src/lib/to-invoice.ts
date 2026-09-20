import type { Invoice, InvoiceStatus } from '@novastarter/payments';
import type { Transaction, TransactionNotification } from '@paddle/paddle-node-sdk';

/**
 * A Paddle transaction as the API returns it or as a webhook carries it.
 */
export type PaddleTransactionLike = Transaction | TransactionNotification;

/**
 * How a transaction's status reads as an invoice status: `ready`, `billed` and `past_due` are open for payment,
 * `paid` and `completed` are paid, a canceled transaction is void.
 *
 * @defaultValue `draft`, `ready` / `billed` / `past_due` → `open`, `paid` / `completed` → `paid`, `canceled` → `void`
 */
export const TRANSACTION_STATUS: Record<string, InvoiceStatus> = {
	draft: 'draft',
	ready: 'open',
	billed: 'open',
	past_due: 'open',
	paid: 'paid',
	completed: 'paid',
	canceled: 'void',
};

/**
 * A Paddle transaction as the kit's invoice — Paddle has transactions where Stripe has invoices, one per charge.
 *
 * The amounts are the transaction's grand total and balance in the currency's minor unit, which Paddle reports as
 * strings. A paid transaction is paid when its captured payment was captured, else when it was billed. The hosted
 * and PDF links stay `null`: Paddle renders the invoice PDF on request (`transactions.getInvoicePDF`), one call per
 * transaction, which a list must not pay for.
 *
 * @param transaction - Paddle's.
 * @returns The normalised invoice.
 */
export const toInvoice = (transaction: PaddleTransactionLike): Invoice => {
	// 1. Totals arrive as strings in the minor unit; an unknown status reads as open, the safer default
	const status = TRANSACTION_STATUS[transaction.status] ?? 'open';
	const totals = transaction.details?.totals;
	const total = Number(totals?.grandTotal ?? totals?.total ?? 0);
	const balance = Number(totals?.balance ?? 0);
	const captured = transaction.payments.find((payment) => payment.status === 'captured');

	// 2. `capturedAt` is the moment of payment; a completed transaction without one was billed and settled at once
	const paidAt = status === 'paid' ? (captured?.capturedAt ?? transaction.billedAt ?? transaction.createdAt) : null;

	// 3. Paid means paid in full; otherwise what was captured so far is the balance's complement
	return {
		id: transaction.id,
		number: transaction.invoiceNumber,
		customerId: transaction.customerId ?? '',
		subscriptionId: transaction.subscriptionId,
		status,
		total: { amount: total, currency: transaction.currencyCode },
		amountPaid: status === 'paid' ? total : Math.max(0, total - balance),
		amountDue: status === 'paid' ? 0 : balance,
		createdAt: new Date(transaction.createdAt),
		dueAt: null,
		paidAt: paidAt ? new Date(paidAt) : null,
		hostedUrl: null,
		pdfUrl: null,
	};
};
