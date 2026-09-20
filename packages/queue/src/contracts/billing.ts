import { z } from 'zod';
import { defineJob } from '../lib/define-job.js';
import type { JobContract } from '../types.js';

/**
 * A date on the wire: a `Date` when the job runs in the enqueuing process, an ISO string once it went through
 * Redis as JSON. The schema accepts both and always hands the handler a `Date`.
 */
type WireDate = Date | string;

/**
 * The subscription statuses the payments contract normalises to.
 *
 * @defaultValue The eight statuses Stripe and Polar share.
 */
export const BILLING_SUBSCRIPTION_STATUSES = [
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused',
] as const;

/**
 * The invoice statuses the payments contract normalises to.
 *
 * @defaultValue `draft`, `open`, `paid`, `void`, `uncollectible`
 */
export const BILLING_INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const;

/**
 * The billing intervals the payments contract normalises to.
 *
 * @defaultValue `day`, `week`, `month`, `year`
 */
export const BILLING_INTERVALS = ['day', 'week', 'month', 'year'] as const;

/**
 * A subscription as `@novastarter/payments` normalises it, with dates as they travel.
 *
 * @typeParam D - `Date` in the handler, `WireDate` on input.
 */
export interface BillingSubscription<D = Date> {
	id: string;
	customerId: string;
	status: (typeof BILLING_SUBSCRIPTION_STATUSES)[number];
	priceId: string;
	productId: string | null;
	quantity: number;
	interval: (typeof BILLING_INTERVALS)[number];
	currentPeriodStart: D | null;
	currentPeriodEnd: D | null;
	cancelAtPeriodEnd: boolean;
	cancelAt: D | null;
	canceledAt: D | null;
	trialEnd: D | null;
	endedAt: D | null;
	metadata: Record<string, string>;
}

/**
 * An invoice as `@novastarter/payments` normalises it, with dates as they travel.
 *
 * @typeParam D - `Date` in the handler, `WireDate` on input.
 */
export interface BillingInvoice<D = Date> {
	id: string;
	number: string | null;
	customerId: string;
	subscriptionId: string | null;
	status: (typeof BILLING_INVOICE_STATUSES)[number];
	total: { amount: number; currency: string };
	amountPaid: number;
	amountDue: number;
	createdAt: D;
	dueAt: D | null;
	paidAt: D | null;
	hostedUrl: string | null;
	pdfUrl: string | null;
}

/**
 * A finished checkout as `@novastarter/payments` normalises it.
 */
export interface BillingCheckout {
	id: string;
	customerId: string;
	subscriptionId: string | null;
	metadata: Record<string, string>;
}

/**
 * What every billing event carries.
 *
 * @typeParam D - `Date` in the handler, `WireDate` on input.
 */
interface BillingEventBase<D = Date> {
	/** The provider's event id — the sync applies each id once. */
	id: string;
	/** The driver name: `stripe`, `polar`. */
	provider: string;
	occurredAt: D;
	/** The provider's own payload, for the audit trail. */
	raw?: unknown;
}

/**
 * The payload of `billing.sync`: a normalised provider event — the `PaymentsEvent` of `@novastarter/payments`, spelled
 * out here because this is the wire format between the web app and the worker, and the queue does not depend on the
 * payments package.
 *
 * @typeParam D - `Date` in the handler, `WireDate` on input.
 */
export type BillingSyncEvent<D = Date> =
	| (BillingEventBase<D> & { type: 'checkout.completed'; checkout: BillingCheckout })
	| (BillingEventBase<D> & {
			type: 'subscription.created' | 'subscription.updated' | 'subscription.deleted';
			subscription: BillingSubscription<D>;
	  })
	| (BillingEventBase<D> & { type: 'invoice.paid' | 'invoice.failed'; invoice: BillingInvoice<D> });

/**
 * What a caller passes to `billing.sync`: the event as the driver produced it, dates as `Date` or ISO strings.
 */
export type BillingSyncInput = BillingSyncEvent<WireDate>;

/**
 * What the `billing.sync` handler receives: the event with every date a `Date`.
 */
export type BillingSyncPayload = BillingSyncEvent<Date>;

/**
 * A date that may have been through JSON: a `Date` stays one, an ISO string becomes one.
 */
const wireDate: z.ZodType<Date, WireDate> = z.union([
	z.date(),
	z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
]);

/**
 * The nullable form of {@link wireDate}, without `z.coerce`, which would turn `null` into the epoch.
 */
const nullableWireDate: z.ZodType<Date | null, WireDate | null> = z.union([z.null(), wireDate]);

const metadataSchema = z.record(z.string(), z.string());

const subscriptionSchema: z.ZodType<BillingSubscription, BillingSubscription<WireDate>> = z.object({
	id: z.string().min(1),
	customerId: z.string(),
	status: z.enum(BILLING_SUBSCRIPTION_STATUSES),
	priceId: z.string(),
	productId: z.string().nullable(),
	quantity: z.number().int().nonnegative(),
	interval: z.enum(BILLING_INTERVALS),
	currentPeriodStart: nullableWireDate,
	currentPeriodEnd: nullableWireDate,
	cancelAtPeriodEnd: z.boolean(),
	cancelAt: nullableWireDate,
	canceledAt: nullableWireDate,
	trialEnd: nullableWireDate,
	endedAt: nullableWireDate,
	metadata: metadataSchema,
});

const invoiceSchema: z.ZodType<BillingInvoice, BillingInvoice<WireDate>> = z.object({
	id: z.string().min(1),
	number: z.string().nullable(),
	customerId: z.string(),
	subscriptionId: z.string().nullable(),
	status: z.enum(BILLING_INVOICE_STATUSES),
	total: z.object({ amount: z.number().int(), currency: z.string() }),
	amountPaid: z.number().int(),
	amountDue: z.number().int(),
	createdAt: wireDate,
	dueAt: nullableWireDate,
	paidAt: nullableWireDate,
	hostedUrl: z.string().nullable(),
	pdfUrl: z.string().nullable(),
});

const checkoutSchema: z.ZodType<BillingCheckout, BillingCheckout> = z.object({
	id: z.string().min(1),
	customerId: z.string(),
	subscriptionId: z.string().nullable(),
	metadata: metadataSchema,
});

const base = {
	id: z.string().min(1),
	provider: z.string().min(1),
	occurredAt: wireDate,
	raw: z.unknown(),
};

/**
 * The schema of a `billing.sync` payload: the event's type decides which object rides along.
 */
export const billingSyncSchema: z.ZodType<BillingSyncPayload, BillingSyncInput> = z.discriminatedUnion('type', [
	z.object({ ...base, type: z.literal('checkout.completed'), checkout: checkoutSchema }),
	z.object({
		...base,
		type: z.enum(['subscription.created', 'subscription.updated', 'subscription.deleted']),
		subscription: subscriptionSchema,
	}),
	z.object({ ...base, type: z.enum(['invoice.paid', 'invoice.failed']), invoice: invoiceSchema }),
]);

/**
 * `billing.sync` — apply a provider's webhook event to the billing tables.
 *
 * Enqueued by the webhook route the moment the signature verifies, so the provider gets its 200 without waiting
 * for the database; the handler (`syncSubscription()` of `@novastarter/payments`, registered by the billing module)
 * applies it once per event id. Unique by provider and event id while queued, so a provider retrying a delivery
 * the route already accepted does not queue it twice; five tries with growing waits, since a failure here is the
 * database, not the payload.
 */
export const billingSync: JobContract<'billing.sync', typeof billingSyncSchema> = defineJob({
	name: 'billing.sync',
	schema: billingSyncSchema,
	options: {
		attempts: 5,
		backoff: { type: 'exponential', delay: 5_000 },
		unique: (payload: BillingSyncPayload) => `${payload.provider}_${payload.id}`,
		removeOnComplete: true,
	},
});
