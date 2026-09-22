/**
 * A JSON:API resource object as Lemon Squeezy returns it.
 *
 * The types of this module cover the parts of the resources the driver reads — the fields of the documented
 * attributes it maps, no more. The API is versioned (`/v1`) and adds fields without breaking, so a resource may
 * carry more.
 *
 * @typeParam A - The attributes of the resource type.
 */
export interface LsResource<A> {
	type: string;
	id: string;
	attributes: A;
}

/**
 * A response with one resource, or a list of them.
 *
 * @typeParam A - The attributes of the resource type.
 */
export interface LsDocument<A> {
	data: LsResource<A>;
}

/**
 * A list response; `meta.page` carries the pagination.
 *
 * @typeParam A - The attributes of the resource type.
 */
export interface LsListDocument<A> {
	data: LsResource<A>[];
	meta?: { page?: { currentPage: number; lastPage: number; total: number } } | undefined;
}

/**
 * One error of a JSON:API error response.
 */
export interface LsError {
	status?: string | undefined;
	title?: string | undefined;
	detail?: string | undefined;
}

/**
 * The statuses a Lemon Squeezy subscription reports.
 */
export type LsSubscriptionStatus =
	'on_trial' | 'active' | 'paused' | 'pause' | 'past_due' | 'unpaid' | 'cancelled' | 'expired';

/**
 * A subscription's attributes.
 */
export interface LsSubscriptionAttributes {
	store_id: number;
	customer_id: number;
	order_id: number;
	product_id: number;
	variant_id: number;
	user_email: string;
	status: LsSubscriptionStatus;
	cancelled: boolean;
	trial_ends_at: string | null;
	pause: { mode: 'void' | 'free'; resumes_at?: string | null | undefined } | null;
	first_subscription_item: { id: number; subscription_id: number; price_id: number; quantity: number } | null;
	urls: { update_payment_method: string; customer_portal: string; customer_portal_update_subscription: string };
	renews_at: string;
	ends_at: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * A subscription invoice's attributes — one per charge of a subscription.
 */
export interface LsSubscriptionInvoiceAttributes {
	store_id: number;
	subscription_id: number;
	customer_id: number;
	billing_reason: string;
	currency: string;
	status: 'pending' | 'paid' | 'void' | 'refunded';
	refunded: boolean;
	refunded_at: string | null;
	total: number;
	urls: { invoice_url: string | null };
	created_at: string;
	updated_at: string;
}

/**
 * An order's attributes — the purchase a checkout ends in.
 */
export interface LsOrderAttributes {
	store_id: number;
	customer_id: number;
	identifier: string;
	order_number: number;
	user_email: string;
	currency: string;
	status: 'pending' | 'failed' | 'paid' | 'refunded';
	total: number;
	first_order_item: { id: number; order_id: number; product_id: number; variant_id: number; quantity: number } | null;
	urls: { receipt: string };
	created_at: string;
	updated_at: string;
}

/**
 * A customer's attributes.
 */
export interface LsCustomerAttributes {
	store_id: number;
	name: string;
	email: string;
	status: string;
	urls: { customer_portal: string | null };
	created_at: string;
	updated_at: string;
}

/**
 * A checkout's attributes.
 */
export interface LsCheckoutAttributes {
	store_id: number;
	variant_id: number;
	url: string;
	expires_at: string | null;
	created_at: string;
}

/**
 * A variant's attributes — the part that says how it bills.
 */
export interface LsVariantAttributes {
	product_id: number;
	name: string;
	is_subscription: boolean;
	interval: 'day' | 'week' | 'month' | 'year' | null;
	interval_count: number | null;
}

/**
 * A webhook delivery: the event name and the checkout's custom data under `meta`, the resource under `data`.
 *
 * @typeParam A - The attributes of the resource under `data`; `unknown` until the event name narrows it.
 */
export interface LsWebhookPayload<A = unknown> {
	meta: {
		event_name: string;
		custom_data?: Record<string, unknown> | undefined;
		webhook_id?: string | undefined;
		test_mode?: boolean | undefined;
	};
	data: LsResource<A>;
}
